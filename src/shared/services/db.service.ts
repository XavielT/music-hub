import { Injectable } from '@angular/core';

// One IndexedDB per account: `music-hub-db::{userId}`. A single shared database
// leaked one user's library (and their downloaded audio) into the next account
// signed in on the same device, so the name is scoped to the user.
const DB_PREFIX = 'music-hub-db::';
// The database every version before per-user storage wrote to. It is migrated
// into the first account that signs in and then removed.
const LEGACY_DB_NAME = 'music-hub-db';
const LEGACY_CLAIM_KEY = 'music-hub-legacy-db-claim';
const DB_VERSION = 3;

const STORES = ['songs', 'files', 'playlists', 'covers'] as const;

// Lightweight IndexedDB wrapper: song metadata, audio blobs, playlists and
// cover art live on the device so the app works fully offline.
@Injectable({ providedIn: 'root' })
export class DbService {
  // The database of the signed-in user. Null until `use()` has been called.
  private activeDb: Promise<IDBDatabase> | null = null;
  private activeUserId: string | null = null;

  // Anything that reads or writes before `use()` parks on this promise instead
  // of racing onto a database that does not belong to anybody yet.
  private readonly firstDb: Promise<IDBDatabase>;
  private announceFirstDb!: (db: IDBDatabase) => void;

  constructor() {
    this.firstDb = new Promise(resolve => (this.announceFirstDb = resolve));
  }

  // Points the service at one user's database, migrating the legacy shared
  // database into it the first time round. Every pending call resolves onto it.
  async use(userId: string): Promise<void> {
    if (this.activeUserId === userId) {
      await this.activeDb;
      return;
    }

    const previous = this.activeDb;
    this.activeUserId = userId;
    const opening = this.openUserDb(userId);
    this.activeDb = opening;

    // Drop the previous account's connection once the new one is up.
    previous?.then(db => db.close()).catch(() => undefined);

    const db = await opening;
    // No-op after the first call: `activeDb` is what later calls await.
    this.announceFirstDb(db);
  }

  private async openUserDb(userId: string): Promise<IDBDatabase> {
    const db = await this.openDb(DB_PREFIX + userId);
    try {
      await this.migrateLegacyDb(userId, db);
    } catch (err) {
      // A failed migration must not keep the user out of their library: the
      // legacy database is left in place and retried on the next sign-in.
      console.warn('legacy IndexedDB migration failed', err);
    }
    return db;
  }

  private openDb(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
        // Cover art, keyed by song id like `files`. Version 2 adds this; an
        // existing database gets the store and keeps everything else.
        if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers');
        // Where playback had got to, so the app can resume. One keyed entry,
        // not a collection — added in version 3. Deliberately outside STORES:
        // it is per-device state, and the legacy database has nothing to
        // migrate into it.
        if (!db.objectStoreNames.contains('player')) db.createObjectStore('player');
      };
      // Another tab holding the previous version open stalls the upgrade
      // until it lets go. The onversionchange handler below is what makes it
      // let go; this is here so the wait is visible if it ever happens anyway.
      req.onblocked = () => console.warn(`IndexedDB upgrade of ${name} is waiting on another tab`);
      req.onsuccess = () => {
        const db = req.result;
        // A newer tab asking for a version this one does not have gets to
        // proceed: hanging on to the old connection would block it forever.
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // --- One-time migration off the shared database ---

  // Copies `music-hub-db` into the given per-user database and deletes it, so
  // the first account to sign in inherits the library that was already here.
  private async migrateLegacyDb(userId: string, target: IDBDatabase): Promise<void> {
    if (!(await this.legacyDbMayExist())) return;

    // Exactly one account adopts the old shared library — the first one to
    // sign in on this device. Everybody else starts empty.
    const claimedBy = this.readClaim();
    if (claimedBy && claimedBy !== userId) return;
    if (!claimedBy) this.writeClaim(userId);

    const legacy = await this.openDb(LEGACY_DB_NAME);
    let taken = false;
    try {
      // Opening it created it if it was already gone: nothing to take over,
      // but the empty shell still gets cleaned up.
      if (await this.isEmpty(legacy)) {
        taken = true;
      } else {
        for (const store of STORES) {
          // The legacy database is version 1 and has no `covers` store.
          if (!legacy.objectStoreNames.contains(store)) continue;
          const source = legacy.transaction(store, 'readonly').objectStore(store);
          const [keys, values] = await Promise.all([
            this.request(source.getAllKeys()),
            this.request(source.getAll() as IDBRequest<unknown[]>),
          ]);
          if (!values.length) continue;

          // `songs` and `playlists` key off `id`; `files` and `covers` use
          // out-of-line keys.
          const inline = store !== 'files' && store !== 'covers';
          const tx = target.transaction(store, 'readwrite');
          const dest = tx.objectStore(store);
          values.forEach((value, i) => (inline ? dest.put(value) : dest.put(value, keys[i])));
          await this.done(tx);
        }
        taken = true;
        console.info('migrated the legacy music-hub-db into the per-user database');
      }
    } finally {
      legacy.close();
    }
    // Only drop the old database once everything is really across. A partial
    // run leaves it alone and is retried (by key, so re-copying is harmless).
    if (taken) await this.deleteDb(LEGACY_DB_NAME);
  }

  // `indexedDB.databases()` is not everywhere (older Safari): when it is
  // missing we say "maybe" and let the open-and-count path decide.
  private async legacyDbMayExist(): Promise<boolean> {
    const list = (indexedDB as { databases?: () => Promise<{ name?: string }[]> }).databases;
    if (!list) return true;
    try {
      return (await list.call(indexedDB)).some(info => info.name === LEGACY_DB_NAME);
    } catch {
      return true;
    }
  }

  // Which account took over the legacy database, so a retry after a partial
  // migration goes to the same one.
  private readClaim(): string | null {
    try {
      return localStorage.getItem(LEGACY_CLAIM_KEY);
    } catch {
      return null;
    }
  }

  private writeClaim(userId: string): void {
    try {
      localStorage.setItem(LEGACY_CLAIM_KEY, userId);
    } catch {
      // Storage unavailable: the legacy database is deleted after a successful
      // copy anyway, so only the first account can end up with it.
    }
  }

  private async isEmpty(db: IDBDatabase): Promise<boolean> {
    for (const store of STORES) {
      if (!db.objectStoreNames.contains(store)) continue;
      const count = await this.request(db.transaction(store, 'readonly').objectStore(store).count());
      if (count > 0) return false;
    }
    return true;
  }

  private deleteDb(name: string): Promise<void> {
    return new Promise(resolve => {
      const req = indexedDB.deleteDatabase(name);
      // `blocked` means another tab still holds it open — harmless, it will be
      // gone on the next run. Never leave the caller hanging on it.
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  }

  private done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }

  // --- Store access ---

  private async tx(store: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await (this.activeDb ?? this.firstDb);
    return db.transaction(store, mode).objectStore(store);
  }

  private request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll<T>(store: string): Promise<T[]> {
    return this.request((await this.tx(store, 'readonly')).getAll() as IDBRequest<T[]>);
  }

  async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    return this.request((await this.tx(store, 'readonly')).get(key) as IDBRequest<T | undefined>);
  }

  async put(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
    await this.request((await this.tx(store, 'readwrite')).put(value, key));
  }

  // Used to tell which songs still have their audio blob on this device.
  async getAllKeys(store: string): Promise<IDBValidKey[]> {
    return this.request((await this.tx(store, 'readonly')).getAllKeys());
  }

  async delete(store: string, key: IDBValidKey): Promise<void> {
    await this.request((await this.tx(store, 'readwrite')).delete(key));
  }
}
