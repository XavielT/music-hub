import { DbService } from './db.service';
import { LibraryService } from './library.service';

// Covers the path from "a file's tags had a picture in them" to "the UI has a
// URL it can show", which is the part that has no other way of being tested:
// it spans IndexedDB, a signal and an object URL.

const USER = 'cover-spec-user';
const DB_NAME = `music-hub-db::${USER}`;
const LEGACY_DB_NAME = 'music-hub-db';

// One-pixel JPEG-ish blob. Only the bytes matter, nothing decodes it here.
const PICTURE = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], {
  type: 'image/jpeg',
});

function drop(name: string): Promise<void> {
  return new Promise(resolve => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

// Waits for the artwork to arrive, since resolveCover() is deliberately async.
async function waitForCover(
  library: LibraryService,
  song: { id: string },
  tries = 50
): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    const src = library.coverSrc(library.songs().find(s => s.id === song.id)!);
    if (src) return src;
    await new Promise(r => setTimeout(r, 10));
  }
  return null;
}

describe('LibraryService cover art', () => {
  let db: DbService;
  let library: LibraryService;

  beforeEach(async () => {
    await Promise.all([drop(DB_NAME), drop(LEGACY_DB_NAME)]);
    localStorage.removeItem('music-hub-legacy-db-claim');
    db = new DbService();
    library = new LibraryService(
      db,
      // Nothing here reaches the cloud: these songs stay local.
      { usedBytes: () => 0, addUsage: () => undefined } as never,
      { isAdmin: () => false, user: () => ({ id: USER }) } as never,
      { error: () => undefined, show: () => undefined } as never,
      // Nothing in here goes looking for artwork online.
      { find: async () => null } as never
    );
    await library.activate(USER);
  });

  afterEach(async () => {
    library.deactivate();
    await Promise.all([drop(DB_NAME), drop(LEGACY_DB_NAME)]);
  });

  it('stores a picture passed with a new song and hands back a URL for it', async () => {
    const song = await library.addLocalSong(
      new File([new Uint8Array([1, 2, 3])], 'a.mp3', { type: 'audio/mpeg' }),
      { title: 'T', artist: 'A', album: 'B', duration: 1, picture: PICTURE }
    );

    expect(song.hasCover).toBe(true);
    expect(await db.get<Blob>('covers', song.id)).toBeTruthy();

    const src = await waitForCover(library, song);
    expect(src).toBeTruthy();
    expect(src!.startsWith('blob:')).toBe(true);
  });

  it('returns nothing for a song that came without artwork', async () => {
    const song = await library.addLocalSong(
      new File([new Uint8Array([1, 2, 3])], 'b.mp3', { type: 'audio/mpeg' }),
      { title: 'T', artist: 'A', album: 'B', duration: 1 }
    );

    expect(song.hasCover).toBe(false);
    expect(library.coverSrc(song)).toBeNull();
  });

  it('still finds the artwork after the library is reloaded from disk', async () => {
    const song = await library.addLocalSong(
      new File([new Uint8Array([1, 2, 3])], 'c.mp3', { type: 'audio/mpeg' }),
      { title: 'T', artist: 'A', album: 'B', duration: 1, picture: PICTURE }
    );

    // A fresh sign-in: hasCover has to be derived from the store, not carried
    // over in memory.
    library.deactivate();
    await library.activate(USER);

    const reloaded = library.songs().find(s => s.id === song.id)!;
    expect(reloaded.hasCover).toBe(true);
    expect(await waitForCover(library, song)).toBeTruthy();
  });

  it('keeps a remote thumbnail in preference to stored artwork', async () => {
    const song = await library.addLocalSong(
      new File([new Uint8Array([1, 2, 3])], 'd.mp3', { type: 'audio/mpeg' }),
      { title: 'T', artist: 'A', album: 'B', duration: 1, coverUrl: 'https://img.example/a.jpg' }
    );

    expect(library.coverSrc(song)).toBe('https://img.example/a.jpg');
  });

  it('drops the artwork when the song is removed', async () => {
    const song = await library.addLocalSong(
      new File([new Uint8Array([1, 2, 3])], 'e.mp3', { type: 'audio/mpeg' }),
      { title: 'T', artist: 'A', album: 'B', duration: 1, picture: PICTURE }
    );
    await waitForCover(library, song);

    await library.forgetSongLocally(song.id);

    expect(await db.get<Blob>('covers', song.id)).toBeUndefined();
  });
});
