import { Injectable } from '@angular/core';

const DB_NAME = 'music-hub-db';
const DB_VERSION = 1;

// Lightweight IndexedDB wrapper: song metadata, audio blobs and playlists
// live on the device so the app works fully offline.
@Injectable({ providedIn: 'root' })
export class DbService {
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = this.open();
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async tx(store: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.dbPromise;
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

  async delete(store: string, key: IDBValidKey): Promise<void> {
    await this.request((await this.tx(store, 'readwrite')).delete(key));
  }
}
