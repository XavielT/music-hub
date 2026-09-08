export interface PlaylistModel {
  id: string;
  name: string;
  songIds: string[]; // ordered; positions come from playlist_songs.position
  coverColor: string;
  createdAt: number;

  // --- cloud fields ---
  ownerId: string;
  // 'local-only' means it still has to be pushed (created or edited offline).
  syncState: 'local-only' | 'synced';
  // Shared playlists are visible to every member and any of them can change
  // which songs are in one. Renaming, unsharing and deleting stay with the
  // owner.
  isShared: boolean;
  // Who to credit for a playlist somebody else shared. Kept on the playlist
  // rather than looked up, so the name is still there offline.
  ownerName?: string;
}

export function normalizePlaylist(raw: Partial<PlaylistModel> & { id: string }): PlaylistModel {
  return {
    ...(raw as PlaylistModel),
    songIds: raw.songIds ?? [],
    ownerId: raw.ownerId ?? '',
    syncState: raw.syncState ?? 'local-only',
    isShared: raw.isShared ?? false,
  };
}
