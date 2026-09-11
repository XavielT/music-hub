import { DbService } from './db.service';

// The upgrade to database version 2 (which adds the `covers` store) is the
// first this app has ever shipped, and it runs against libraries that people
// cannot get back if it goes wrong. These drive the real DbService against a
// real IndexedDB, starting from a database in the exact shape version 1 left
// behind.

const USER = 'upgrade-spec-user';
const DB_NAME = `music-hub-db::${USER}`;
const LEGACY_DB_NAME = 'music-hub-db';

function open(name: string, version: number, upgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade?.(req.result);
    req.onsuccess = () => {
      const db = req.result;
      // Otherwise a connection left open here blocks the next spec's upgrade.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Deletes a database and waits until it is actually gone.
 *
 * `onblocked` deliberately does not resolve. It fires when a connection is
 * still open, which means the database is *not* deleted — resolving there would
 * report success and let the next spec seed a version 1 database on top of a
 * version 2 one, which surfaces as a VersionError a long way from its cause.
 * DbService closes its connection from `onversionchange`, so the delete does go
 * through and `onsuccess` follows. The timeout is there so that if it ever
 * stops going through, this says so, instead of hanging until Jasmine's own
 * timeout blames whichever spec happened to be running.
 */
function drop(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    const timer = setTimeout(
      () =>
        reject(
          new Error(`deleteDatabase(${name}) is still blocked — a connection was left open`)
        ),
      3000
    );
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    req.onsuccess = req.onerror = finish;
    req.onblocked = () =>
      console.warn(`deleteDatabase(${name}) blocked, waiting for the connection to close`);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

// A version-1 database: the three stores that existed before covers, with a
// song, its audio blob and a playlist already in them.
async function seedVersion1(name: string): Promise<void> {
  const db = await open(name, 1, d => {
    d.createObjectStore('songs', { keyPath: 'id' });
    d.createObjectStore('files');
    d.createObjectStore('playlists', { keyPath: 'id' });
  });
  const tx = db.transaction(['songs', 'files', 'playlists'], 'readwrite');
  tx.objectStore('songs').put({ id: 's1', title: 'Old Song', artist: 'A', album: 'B', downloaded: true });
  tx.objectStore('files').put(new Blob(['fake audio bytes']), 's1');
  tx.objectStore('playlists').put({ id: 'p1', name: 'Mix', songIds: ['s1'] });
  await done(tx);
  db.close();
}

describe('DbService version 2 upgrade', () => {
  let db: DbService;

  beforeEach(async () => {
    await Promise.all([drop(DB_NAME), drop(LEGACY_DB_NAME)]);
    localStorage.removeItem('music-hub-legacy-db-claim');
    db = new DbService();
  });

  afterEach(async () => {
    await Promise.all([drop(DB_NAME), drop(LEGACY_DB_NAME)]);
  });

  it('keeps the existing library when upgrading a version 1 database', async () => {
    await seedVersion1(DB_NAME);

    await db.use(USER);

    const song = await db.get<{ title: string }>('songs', 's1');
    const audio = await db.get<Blob>('files', 's1');
    const playlist = await db.get<{ name: string }>('playlists', 'p1');
    expect(song?.title).toBe('Old Song');
    expect(audio instanceof Blob).toBe(true);
    expect(audio!.size).toBe(16);
    expect(playlist?.name).toBe('Mix');
  });

  it('adds a covers store that round-trips an image blob', async () => {
    await seedVersion1(DB_NAME);

    await db.use(USER);
    const cover = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' });
    await db.put('covers', cover, 's1');

    const stored = await db.get<Blob>('covers', 's1');
    expect(stored instanceof Blob).toBe(true);
    expect(stored!.type).toBe('image/jpeg');
    const bytes = new Uint8Array(await stored!.arrayBuffer());
    // Bytes have to survive intact — a cover that decodes to nothing renders
    // as a broken image rather than falling back to the letter tile.
    expect(Array.from(bytes.slice(0, 2))).toEqual([0xff, 0xd8]);
  });

  it('reports cover keys, which is how load() decides a song has artwork', async () => {
    await db.use(USER);
    await db.put('covers', new Blob(['x']), 's1');

    expect((await db.getAllKeys('covers')).map(String)).toEqual(['s1']);
  });

  it('creates a fresh database with all four stores', async () => {
    await db.use(USER);
    await db.put('songs', { id: 's9', title: 'New' });
    await db.put('files', new Blob(['a']), 's9');
    await db.put('playlists', { id: 'p9', name: 'P' });
    await db.put('covers', new Blob(['c']), 's9');

    expect((await db.getAllKeys('covers')).map(String)).toEqual(['s9']);
    expect(await db.get('songs', 's9')).toBeTruthy();
  });

  it('migrates a legacy version 1 database that has no covers store', async () => {
    // The pre-per-user database is version 1 and predates `covers`; reading it
    // must not assume the store is there.
    await seedVersion1(LEGACY_DB_NAME);

    await db.use(USER);

    const song = await db.get<{ title: string }>('songs', 's1');
    const audio = await db.get<Blob>('files', 's1');
    expect(song?.title).toBe('Old Song');
    expect(audio instanceof Blob).toBe(true);
    // And the new store is usable on the migrated database.
    await db.put('covers', new Blob(['c']), 's1');
    expect((await db.getAllKeys('covers')).map(String)).toEqual(['s1']);
  });
});
