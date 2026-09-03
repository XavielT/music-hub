export type SongSource = 'local' | 'remote';

// Where a song currently stands relative to the cloud.
//  local-only  : lives only in this device's IndexedDB, not uploaded yet
//  uploading   : upload in flight
//  synced      : a row exists in Supabase `songs`
//  downloading : pulling the audio down for offline use
export type SyncState = 'local-only' | 'synced' | 'downloading' | 'uploading';

export interface SongModel {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  source: SongSource;
  url?: string; // stream url when source is 'remote'
  coverUrl?: string; // real cover art (e.g. YouTube thumbnail)
  coverColor: string;
  addedAt: number;

  // --- cloud fields ---
  ownerId: string; // Supabase user id ('' while the song has no owner yet)
  storagePath?: string; // path in the `songs` bucket: {ownerId}/{songId}.{ext}
  sizeBytes: number;
  syncState: SyncState;
  downloaded: boolean; // audio blob present in IndexedDB `files`
}

// Songs stored before the cloud fields existed load without them. Fill in
// safe defaults so the rest of the app can assume the full shape.
export function normalizeSong(raw: Partial<SongModel> & { id: string }, hasBlob: boolean): SongModel {
  return {
    ...(raw as SongModel),
    ownerId: raw.ownerId ?? '',
    storagePath: raw.storagePath,
    sizeBytes: raw.sizeBytes ?? 0,
    syncState: raw.syncState ?? 'local-only',
    downloaded: raw.downloaded ?? hasBlob,
  };
}
