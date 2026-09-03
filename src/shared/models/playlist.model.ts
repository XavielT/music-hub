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
}

export function normalizePlaylist(raw: Partial<PlaylistModel> & { id: string }): PlaylistModel {
  return {
    ...(raw as PlaylistModel),
    songIds: raw.songIds ?? [],
    ownerId: raw.ownerId ?? '',
    syncState: raw.syncState ?? 'local-only',
  };
}
