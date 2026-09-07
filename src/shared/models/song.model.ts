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
  coverUrl?: string; // remote cover art (e.g. a YouTube thumbnail)
  coverColor: string;
  addedAt: number;

  // --- cloud fields ---
  ownerId: string; // Supabase user id ('' while the song has no owner yet)
  storagePath?: string; // path in the `songs` bucket: {ownerId}/{songId}.{ext}
  sizeBytes: number;
  syncState: SyncState;
  downloaded: boolean; // audio blob present in IndexedDB `files`
  coverPath?: string; // path in the `covers` bucket: {ownerId}/{songId}.{ext}
  hasCover: boolean; // cover blob present in IndexedDB `covers`
  // Artwork has already been searched for online and not found. Device-only:
  // without it every backfill would ask about the same unmatchable songs again.
  artworkChecked?: boolean;
  // Edited on this device while offline (or while the push failed). Sync
  // pushes these and clears the flag; until then applyRow must not overwrite
  // the local title/artist/album with the cloud's older copy.
  dirty?: boolean;
}

// Songs stored before the cloud fields existed load without them. Fill in
// safe defaults so the rest of the app can assume the full shape.
export function normalizeSong(
  raw: Partial<SongModel> & { id: string },
  hasBlob: boolean,
  hasCover: boolean
): SongModel {
  return {
    ...(raw as SongModel),
    ownerId: raw.ownerId ?? '',
    storagePath: raw.storagePath,
    sizeBytes: raw.sizeBytes ?? 0,
    syncState: raw.syncState ?? 'local-only',
    downloaded: raw.downloaded ?? hasBlob,
    coverPath: raw.coverPath,
    artworkChecked: raw.artworkChecked,
    dirty: raw.dirty,
    // Derived from what is really in the store rather than trusted from the
    // record, the same way `downloaded` is: a cleared database would otherwise
    // leave every song pointing at art that is gone.
    hasCover,
  };
}
