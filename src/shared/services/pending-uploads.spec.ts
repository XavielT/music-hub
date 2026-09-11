import { DbService } from './db.service';
import { LibraryService } from './library.service';
import { I18nService } from './i18n.service';
import { SongModel } from '../models/song.model';

// A member may now add to the shared library, and their upload waits for an
// admin. While it waits it is theirs: editable, withdrawable, invisible to
// everyone else. Once approved it belongs to the household and only an admin
// touches it.
//
// The database is what enforces that pair — a policy plus a trigger, both
// verified against the live project. What these pin down is the app's mirror of
// it, which is the half that silently drifts and starts offering buttons the
// database will refuse.

const USER = 'member-1';
const DB_NAME = `music-hub-db::${USER}`;
const LEGACY_DB_NAME = 'music-hub-db';

function drop(name: string): Promise<void> {
  return new Promise(resolve => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

describe('pending uploads', () => {
  let db: DbService;
  let library: LibraryService;

  async function build(isAdmin: boolean, online = true): Promise<void> {
    await Promise.all([drop(DB_NAME), drop(LEGACY_DB_NAME)]);
    localStorage.removeItem('music-hub-legacy-db-claim');
    db = new DbService();
    library = new LibraryService(
      db,
      {
        usedBytes: () => 0,
        addUsage: () => undefined,
        updateSongInfo: async () => undefined,
        attachCover: async () => 'owner/x.jpg',
        deleteSong: async () => undefined,
      } as never,
      { isAdmin: () => isAdmin, user: () => ({ id: USER }) } as never,
      { error: () => undefined, show: () => undefined } as never,
      { maxUploadBytes: () => 1024 * 1024 * 1024, maxUploadMb: () => 1024 } as never,
      { find: async () => null } as never,
      new I18nService()
    );
    await library.activate(USER);
    if (!online) spyOnProperty(navigator, 'onLine', 'get').and.returnValue(false);
  }

  afterEach(async () => {
    library?.deactivate();
    await Promise.all([drop(DB_NAME), drop(LEGACY_DB_NAME)]);
  });

  function song(over: Partial<SongModel>): SongModel {
    return {
      id: 's1',
      title: 'T',
      artist: 'A',
      album: 'B',
      duration: 1,
      source: 'local',
      coverColor: '#fff',
      addedAt: 0,
      ownerId: USER,
      sizeBytes: 1,
      syncState: 'synced',
      downloaded: false,
      hasCover: false,
      ...over,
    } as SongModel;
  }

  it('knows my own pending upload from everyone else’s', async () => {
    await build(false);
    expect(library.isMyPending(song({ pendingApproval: true }))).toBe(true);
    expect(library.isMyPending(song({ pendingApproval: true, ownerId: 'somebody-else' }))).toBe(false);
    // Approved is the whole point: once it is in, it is not mine any more.
    expect(library.isMyPending(song({ pendingApproval: false }))).toBe(false);
    expect(library.isMyPending(song({}))).toBe(false);
  });

  it('lets a member edit their own upload while it waits, and not after', async () => {
    await build(false);
    expect(library.canEdit(song({ pendingApproval: true }))).toBe(true);
    expect(library.canPushEdits(song({ pendingApproval: true }))).toBe(true);

    const approved = song({ pendingApproval: false });
    expect(library.canEdit(approved)).toBe(false);
    expect(library.canPushEdits(approved)).toBe(false);
  });

  it('does not let a member edit somebody else’s pending upload', async () => {
    await build(false);
    const theirs = song({ pendingApproval: true, ownerId: 'somebody-else' });
    expect(library.canEdit(theirs)).toBe(false);
    expect(library.canPushEdits(theirs)).toBe(false);
  });

  it('still lets an admin edit anything in the shared library', async () => {
    await build(true);
    expect(library.canEdit(song({}))).toBe(true);
    expect(library.canPushEdits(song({}))).toBe(true);
    expect(library.canEdit(song({ pendingApproval: true, ownerId: 'somebody-else' }))).toBe(true);
  });

  it('keeps an edit local when there is no connection to push it with', async () => {
    await build(false, false);
    // Still offered — you can correct it — but it cannot reach the row yet.
    expect(library.canEdit(song({ pendingApproval: true }))).toBe(true);
    expect(library.canPushEdits(song({ pendingApproval: true }))).toBe(false);
  });

  it('leaves a local-only song editable by anyone, as it always was', async () => {
    await build(false);
    expect(library.canEdit(song({ syncState: 'local-only' }))).toBe(true);
  });
});
