import { DbService } from './db.service';
import { LibraryService } from './library.service';
import { PlaylistRow } from './cloud-library.service';

// A shared playlist is the first thing in this app that one account can change
// and another account owns, so the line between the two is what these cover:
// what the UI may offer, what the service refuses outright, and what survives
// the app being opened with no connection.

const ME = 'me-user';
const THEM = 'them-user';
const DB_NAME = `music-hub-db::${ME}`;
const LEGACY_DB_NAME = 'music-hub-db';

function drop(name: string): Promise<void> {
  return new Promise(resolve => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

function row(overrides: Partial<PlaylistRow> = {}): PlaylistRow {
  return {
    id: 'playlist-1',
    owner_id: THEM,
    name: 'Road trip',
    cover_color: '#ff9000',
    is_shared: true,
    created_at: new Date(0).toISOString(),
    ...overrides,
  };
}

describe('Shared playlists', () => {
  let db: DbService;
  let library: LibraryService;
  let cloudCalls: string[];
  let toasts: string[];
  let online: boolean;

  async function build(): Promise<void> {
    await Promise.all([drop(DB_NAME), drop(LEGACY_DB_NAME)]);
    localStorage.removeItem('music-hub-legacy-db-claim');
    cloudCalls = [];
    toasts = [];
    online = true;
    db = new DbService();
    library = new LibraryService(
      db,
      {
        usedBytes: () => 0,
        addUsage: () => undefined,
        createPlaylist: async () => {
          cloudCalls.push('create');
          return row({ owner_id: ME, is_shared: false });
        },
        setPlaylistShared: async (id: string, shared: boolean) => {
          if (!online) throw new Error('offline');
          cloudCalls.push(`share:${id}:${shared}`);
        },
        deletePlaylist: async (id: string) => cloudCalls.push(`delete:${id}`),
      } as never,
      { isAdmin: () => true, user: () => ({ id: ME }) } as never,
      { error: (m: string) => toasts.push(m), show: (m: string) => toasts.push(m) } as never,
      { maxUploadBytes: () => 1024 * 1024 * 1024, maxUploadMb: () => 1024 } as never,
      { find: async () => null } as never
    );
    await library.activate(ME);
  }

  beforeEach(build);

  afterEach(async () => {
    library?.deactivate();
    await Promise.all([drop(DB_NAME), drop(LEGACY_DB_NAME)]);
  });

  it('separates what this account owns from what was shared with it', async () => {
    await library.createPlaylist('Mine');
    await library.applyPlaylistRow(row(), ['song-1']);

    expect(library.myPlaylists().map(p => p.name)).toEqual(['Mine']);
    expect(library.sharedWithMe().map(p => p.name)).toEqual(['Road trip']);
  });

  it('credits the person who shared it, and still does so offline', async () => {
    library.setPeople([{ id: THEM, display_name: 'Ana' }]);
    await library.applyPlaylistRow(row(), []);

    const shared = library.sharedWithMe()[0];
    expect(library.playlistOwnerLabel(shared)).toBe('Ana');

    // Reopening with no connection: nobody to ask, and the name is still there
    // because it was written next to the playlist rather than looked up.
    library.deactivate();
    await library.activate(ME);
    expect(library.playlistOwnerLabel(library.sharedWithMe()[0])).toBe('Ana');
  });

  it('falls back to a neutral label when the name is not known', async () => {
    await library.applyPlaylistRow(row(), []);
    expect(library.playlistOwnerLabel(library.sharedWithMe()[0])).toBe('someone else');
  });

  it('offers renaming and deleting only to the owner', async () => {
    const mine = await library.createPlaylist('Mine');
    await library.applyPlaylistRow(row(), []);

    expect(library.canManagePlaylist(mine)).toBe(true);
    expect(library.canManagePlaylist(library.sharedWithMe()[0])).toBe(false);
  });

  it('refuses to delete a playlist this account does not own', async () => {
    library.setPeople([{ id: THEM, display_name: 'Ana' }]);
    await library.applyPlaylistRow(row(), []);

    await library.deletePlaylist('playlist-1');

    // Still here, and nothing was asked of the cloud — the policy would have
    // refused it, and the next sync would bring it back regardless.
    expect(library.playlists().length).toBe(1);
    expect(cloudCalls.filter(c => c.startsWith('delete'))).toEqual([]);
    expect(toasts[0]).toContain('Ana');
  });

  it('shares a playlist locally first, then pushes it', async () => {
    const mine = await library.createPlaylist('Mine');
    // createPlaylist pushed it, so it counts as synced from here on.
    cloudCalls.length = 0;

    await library.setPlaylistShared(mine.id, true);

    expect(library.playlists()[0].isShared).toBe(true);
    expect(cloudCalls).toEqual([`share:${mine.id}:true`]);
  });

  it('marks a playlist for the next sync when sharing it fails', async () => {
    const mine = await library.createPlaylist('Mine');
    online = false;

    await library.setPlaylistShared(mine.id, true);

    const stored = library.playlists()[0];
    // The switch answered, and the push is owed rather than lost.
    expect(stored.isShared).toBe(true);
    expect(stored.syncState).toBe('local-only');
  });

  it('ignores an attempt to share somebody else\'s playlist', async () => {
    await library.applyPlaylistRow(row({ is_shared: true }), []);

    await library.setPlaylistShared('playlist-1', false);

    expect(library.playlists()[0].isShared).toBe(true);
    expect(cloudCalls).toEqual([]);
  });
});
