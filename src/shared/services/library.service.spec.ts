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

describe('LibraryService editing', () => {
  let db: DbService;
  let library: LibraryService;
  let cloudCalls: string[];
  let cloudUp: boolean;

  async function build(isAdmin: boolean): Promise<void> {
    await Promise.all([drop(DB_NAME), drop(LEGACY_DB_NAME)]);
    localStorage.removeItem('music-hub-legacy-db-claim');
    cloudCalls = [];
    cloudUp = true;
    db = new DbService();
    library = new LibraryService(
      db,
      {
        usedBytes: () => 0,
        addUsage: () => undefined,
        updateSongInfo: async (id: string, info: { title: string }) => {
          if (!cloudUp) throw new Error('offline');
          cloudCalls.push(`update:${id}:${info.title}`);
        },
        attachCover: async (id: string) => {
          if (!cloudUp) throw new Error('offline');
          cloudCalls.push(`cover:${id}`);
          return `owner/${id}.jpg`;
        },
        deleteSong: async (song: { id: string }) => {
          if (!cloudUp) throw new Error('offline');
          cloudCalls.push(`delete:${song.id}`);
        },
      } as never,
      { isAdmin: () => isAdmin, user: () => ({ id: USER }) } as never,
      { error: () => undefined, show: () => undefined } as never,
      { find: async () => null } as never
    );
    await library.activate(USER);
  }

  afterEach(async () => {
    library?.deactivate();
    await Promise.all([drop(DB_NAME), drop(LEGACY_DB_NAME)]);
  });

  async function addSynced(): Promise<string> {
    const song = await library.addLocalSong(
      new File([new Uint8Array([1, 2, 3])], 'x.mp3', { type: 'audio/mpeg' }),
      { title: 'Wrong Title', artist: 'Wrong Artist', album: 'Wrong Album', duration: 1 }
    );
    // Pretend it is in the shared library.
    await library.patchSong(song.id, { syncState: 'synced', storagePath: `owner/${song.id}.mp3` });
    return song.id;
  }

  it('saves an edit locally and pushes it when it can', async () => {
    await build(true);
    const id = await addSynced();

    await library.updateSongInfo(id, { title: 'Right', artist: 'Artist', album: 'Album' });

    const song = library.songs().find(s => s.id === id)!;
    expect(song.title).toBe('Right');
    expect(song.dirty).toBe(false);
    expect(cloudCalls).toContain(`update:${id}:Right`);
  });

  it('keeps an edit made offline and pushes it on the next sync', async () => {
    await build(true);
    const id = await addSynced();
    cloudUp = false;

    await library.updateSongInfo(id, { title: 'Offline Edit', artist: 'A', album: 'B' });

    expect(library.songs().find(s => s.id === id)!.dirty).toBe(true);
    expect(library.dirtySongs().length).toBe(1);

    cloudUp = true;
    await library.pushDirtySongs();

    expect(cloudCalls).toContain(`update:${id}:Offline Edit`);
    expect(library.songs().find(s => s.id === id)!.dirty).toBe(false);
    expect(library.dirtySongs().length).toBe(0);
  });

  it('does not let a sync undo an edit that has not been pushed', async () => {
    await build(true);
    const id = await addSynced();
    cloudUp = false;
    await library.updateSongInfo(id, { title: 'Mine', artist: 'A', album: 'B' });

    // The cloud still holds the old values and sync applies its row.
    await library.applyRow({
      id,
      owner_id: USER,
      title: 'Wrong Title',
      artist: 'Wrong Artist',
      album: 'Wrong Album',
      duration: 1,
      storage_path: `owner/${id}.mp3`,
      remote_url: null,
      cover_url: null,
      cover_path: null,
      cover_color: '#ff9000',
      size_bytes: 3,
      created_at: new Date().toISOString(),
    } as never);

    expect(library.songs().find(s => s.id === id)!.title).toBe('Mine');
    expect(library.songs().find(s => s.id === id)!.dirty).toBe(true);
  });

  it('stores a replacement cover and marks the song as having one', async () => {
    await build(true);
    const id = await addSynced();
    const cover = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });

    await library.updateSongInfo(id, { title: 'T', artist: 'A', album: 'B', cover });

    expect(await db.get<Blob>('covers', id)).toBeTruthy();
    const song = library.songs().find(s => s.id === id)!;
    expect(song.hasCover).toBe(true);
    // A deliberate choice must not be second-guessed by the online lookup.
    expect(song.artworkChecked).toBe(true);
    expect(cloudCalls).toContain(`cover:${id}`);
  });

  it('keeps a member out of the shared row but lets them fix a local song', async () => {
    await build(false);
    const syncedId = await addSynced();
    const local = await library.addLocalSong(
      new File([new Uint8Array([9])], 'y.mp3', { type: 'audio/mpeg' }),
      { title: 'Local', artist: 'A', album: 'B', duration: 1 }
    );

    expect(library.canEdit(library.songs().find(s => s.id === syncedId)!)).toBe(false);
    expect(library.canEdit(library.songs().find(s => s.id === local.id)!)).toBe(true);

    await library.updateSongInfo(local.id, { title: 'Renamed', artist: 'A', album: 'B' });

    expect(library.songs().find(s => s.id === local.id)!.title).toBe('Renamed');
    // Nothing was attempted against the shared library.
    expect(cloudCalls).toEqual([]);
  });

  // 2026-09-11: removing a song from the library took it off the screen and
  // left it in the shared library, because the cloud branch keyed off
  // `syncState` and the song happened to be mid-download. A delete that looks
  // like it worked and did not is the worst version of this bug.
  it('deletes from the shared library even when the song is mid-download', async () => {
    await build(true);
    const id = await addSynced();
    await library.patchSong(id, { syncState: 'downloading' });

    await library.removeSong(id);

    expect(cloudCalls).toContain(`delete:${id}`);
    expect(library.songs().find(s => s.id === id)).toBeUndefined();
  });

  it('leaves a song that was never uploaded to the cloud alone', async () => {
    await build(true);
    const song = await library.addLocalSong(
      new File([new Uint8Array([1, 2, 3])], 'y.mp3', { type: 'audio/mpeg' }),
      { title: 'Mine Only', artist: 'A', album: 'B', duration: 1 }
    );

    await library.removeSong(song.id);

    expect(cloudCalls.filter(c => c.startsWith('delete:'))).toEqual([]);
    expect(library.songs().find(s => s.id === song.id)).toBeUndefined();
  });

  // A member tapping remove on a shared song is asking for space back, not
  // asking to take the song away from everyone.
  it('refuses to remove a shared song for a member, whatever its local state', async () => {
    await build(false);
    const id = await addSynced();
    await library.patchSong(id, { syncState: 'downloading' });

    await library.removeSong(id);

    expect(cloudCalls.filter(c => c.startsWith('delete:'))).toEqual([]);
    expect(library.songs().find(s => s.id === id)).toBeDefined();
  });
});

describe('LibraryService.findDuplicate', () => {
  let library: LibraryService;

  beforeEach(async () => {
    await Promise.all([drop(DB_NAME), drop(LEGACY_DB_NAME)]);
    localStorage.removeItem('music-hub-legacy-db-claim');
    library = new LibraryService(
      new DbService(),
      { usedBytes: () => 0, addUsage: () => undefined } as never,
      { isAdmin: () => false, user: () => ({ id: USER }) } as never,
      { error: () => undefined, show: () => undefined } as never,
      { find: async () => null } as never
    );
    await library.activate(USER);
    await library.addLocalSong(new File([new Uint8Array([1])], 'a.mp3'), {
      title: 'Café Tacvba',
      artist: 'Los Músicos',
      album: 'X',
      duration: 1,
    });
  });

  afterEach(async () => {
    library.deactivate();
    await Promise.all([drop(DB_NAME), drop(LEGACY_DB_NAME)]);
  });

  it('matches through case, accents and punctuation', () => {
    expect(library.findDuplicate('cafe  tacvba!', 'los musicos')?.title).toBe('Café Tacvba');
  });

  it('does not match a different artist with the same title', () => {
    expect(library.findDuplicate('Café Tacvba', 'Somebody Else')).toBeNull();
  });

  it('ignores an empty title rather than matching everything', () => {
    expect(library.findDuplicate('', '')).toBeNull();
  });
});

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
