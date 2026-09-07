import { Injectable, computed, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { SongModel } from '../models/song.model';
import { PlaylistModel } from '../models/playlist.model';

// --- Row shapes (mirror the Supabase schema exactly) ---

export interface SongRow {
  id: string;
  owner_id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  storage_path: string | null;
  remote_url: string | null;
  cover_url: string | null;
  cover_color: string;
  size_bytes: number;
  created_at: string;
}

export interface PlaylistRow {
  id: string;
  owner_id: string;
  name: string;
  cover_color: string;
  created_at: string;
}

export interface PlaylistSongRow {
  playlist_id: string;
  song_id: string;
  position: number;
}

const SONG_COLUMNS =
  'id, owner_id, title, artist, album, duration, storage_path, remote_url, cover_url, cover_color, size_bytes, created_at';
const PLAYLIST_COLUMNS = 'id, owner_id, name, cover_color, created_at';

// navigator.onLine is unreliable in the Android WebView: it keeps reporting
// true in airplane mode. So a dropped connection has to be recognised from the
// failure itself rather than trusted from the flag.
export function isNetworkError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('err_internet') ||
    message.includes('err_network') ||
    message.includes('err_name_not_resolved')
  );
}

export const AUDIO_BUCKET = 'songs';
// Supabase free tier gives 1 GB of Storage.
export const STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024;

// The `songs` bucket only accepts these types. Browsers hand out a few
// non-standard aliases for the same formats, and an unknown one would be
// rejected by the bucket, so map them onto what the bucket allows.
const AUDIO_MIME_ALIASES: Record<string, string> = {
  'audio/mp3': 'audio/mpeg',
  'audio/mpeg3': 'audio/mpeg',
  'audio/x-mpeg': 'audio/mpeg',
  'audio/m4a': 'audio/x-m4a',
  'audio/x-m4a': 'audio/x-m4a',
  'audio/mp4': 'audio/mp4',
  'audio/aac': 'audio/aac',
  'audio/x-aac': 'audio/aac',
  'audio/ogg': 'audio/ogg',
  'audio/vorbis': 'audio/ogg',
  'audio/wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/flac': 'audio/flac',
  'audio/x-flac': 'audio/flac',
  'audio/webm': 'audio/webm',
};

export function audioContentType(file: Blob): string {
  const type = (file.type || '').split(';')[0].trim().toLowerCase();
  // mp3 is the overwhelming majority, so it is also the fallback for a file
  // the browser gave no type for at all.
  return AUDIO_MIME_ALIASES[type] ?? 'audio/mpeg';
}

const SIGNED_URL_TTL_SECONDS = 3600;
// Re-sign 5 minutes before expiry so a long track never dies mid-playback.
const SIGNED_URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;

// Thin, typed wrapper over the Supabase tables and the audio bucket.
// Holds no library state of its own — LibraryService and SyncService do.
@Injectable({ providedIn: 'root' })
export class CloudLibraryService {
  // Sum of size_bytes across the user's cloud songs, for the quota bar.
  private _usedBytes = signal(0);
  usedBytes = this._usedBytes.asReadonly();
  usedFraction = computed(() => Math.min(1, this._usedBytes() / STORAGE_QUOTA_BYTES));

  private signedUrls = new Map<string, { url: string; expiresAt: number }>();

  constructor(private supabase: SupabaseService, private auth: AuthService) {}

  private get client() {
    return this.supabase.client;
  }

  // Signing out (or switching account) must not leave the next user with an
  // hour of valid signed audio URLs and somebody else's quota bar.
  resetSession(): void {
    this.signedUrls.clear();
    this._usedBytes.set(0);
  }

  private userId(): string {
    const id = this.auth.user()?.id;
    if (!id) throw new Error('Not signed in');
    return id;
  }

  // --- Songs ---

  async listSongs(): Promise<SongRow[]> {
    const { data, error } = await this.client
      .from('songs')
      .select(SONG_COLUMNS)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as SongRow[];
    this.recomputeUsage(rows);
    return rows;
  }

  // Inserts the metadata row, then pushes the audio. If the upload fails the
  // row is removed again so the library never shows a song that cannot play.
  async uploadSong(file: Blob, song: SongModel): Promise<SongRow> {
    const ownerId = this.userId();
    const ext = this.extensionFor(file, song);
    const storagePath = `${ownerId}/${song.id}.${ext}`;

    const { error: insertError } = await this.client
      .from('songs')
      .insert({
        id: song.id,
        owner_id: ownerId,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: Math.round(song.duration || 0),
        cover_url: song.coverUrl ?? null,
        cover_color: song.coverColor,
        size_bytes: file.size,
      })
      .select(SONG_COLUMNS)
      .single();
    if (insertError) throw new Error(insertError.message);

    try {
      const { error: uploadError } = await this.client.storage
        .from(AUDIO_BUCKET)
        .upload(storagePath, file, {
          contentType: audioContentType(file),
          upsert: true,
        });
      if (uploadError) throw new Error(uploadError.message);

      const { data: updated, error: updateError } = await this.client
        .from('songs')
        .update({ storage_path: storagePath, size_bytes: file.size })
        .eq('id', song.id)
        .select(SONG_COLUMNS)
        .single();
      if (updateError) throw new Error(updateError.message);
      return updated as SongRow;
    } catch (err) {
      // Roll back both halves so a failed upload leaves nothing behind: the
      // row, and the object it may already have put in the bucket (which
      // would otherwise eat quota invisibly, forever).
      await this.client.storage
        .from(AUDIO_BUCKET)
        .remove([storagePath])
        .catch(() => undefined);
      await this.client.from('songs').delete().eq('id', song.id);
      throw err;
    }
  }

  // Songs added from a direct URL have no storage object.
  async insertRemoteSong(song: SongModel, remoteUrl: string): Promise<SongRow> {
    const { data, error } = await this.client
      .from('songs')
      .insert({
        id: song.id,
        owner_id: this.userId(),
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: Math.round(song.duration || 0),
        remote_url: remoteUrl,
        cover_url: song.coverUrl ?? null,
        cover_color: song.coverColor,
      })
      .select(SONG_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return data as SongRow;
  }

  async deleteSong(song: SongModel): Promise<void> {
    if (song.storagePath) {
      const { error } = await this.client.storage.from(AUDIO_BUCKET).remove([song.storagePath]);
      // A missing object should not block deleting the row.
      if (error) console.warn('storage remove failed', error.message);
    }
    const { error } = await this.client.from('songs').delete().eq('id', song.id);
    if (error) throw new Error(error.message);
    this.signedUrls.delete(song.id);
  }

  // Signed URL for streaming, cached in memory until shortly before expiry.
  async getStreamUrl(song: SongModel): Promise<string> {
    if (!song.storagePath) throw new Error('Song has no cloud audio');
    const cached = this.signedUrls.get(song.id);
    if (cached && cached.expiresAt - SIGNED_URL_REFRESH_MARGIN_MS > Date.now()) return cached.url;

    const { data, error } = await this.client.storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(song.storagePath, SIGNED_URL_TTL_SECONDS);
    if (error || !data) throw new Error(error?.message ?? 'Could not sign the audio URL');

    this.signedUrls.set(song.id, {
      url: data.signedUrl,
      expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
    });
    return data.signedUrl;
  }

  // Downloads the audio for offline playback.
  async downloadAudio(song: SongModel): Promise<Blob> {
    if (!song.storagePath) throw new Error('Song has no cloud audio');
    const { data, error } = await this.client.storage.from(AUDIO_BUCKET).download(song.storagePath);
    if (error || !data) throw new Error(error?.message ?? 'Download failed');
    return data;
  }

  // --- Playlists ---

  async listPlaylists(): Promise<PlaylistRow[]> {
    const { data, error } = await this.client
      .from('playlists')
      .select(PLAYLIST_COLUMNS)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as PlaylistRow[];
  }

  async listPlaylistSongs(): Promise<PlaylistSongRow[]> {
    const { data, error } = await this.client
      .from('playlist_songs')
      .select('playlist_id, song_id, position')
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PlaylistSongRow[];
  }

  async createPlaylist(playlist: PlaylistModel): Promise<PlaylistRow> {
    const { data, error } = await this.client
      .from('playlists')
      .insert({
        id: playlist.id,
        owner_id: this.userId(),
        name: playlist.name,
        cover_color: playlist.coverColor,
      })
      .select(PLAYLIST_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return data as PlaylistRow;
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    const { error } = await this.client.from('playlists').delete().eq('id', playlistId);
    if (error) throw new Error(error.message);
  }

  async addSongToPlaylist(playlistId: string, songId: string, position: number): Promise<void> {
    const { error } = await this.client
      .from('playlist_songs')
      .upsert({ playlist_id: playlistId, song_id: songId, position });
    if (error) throw new Error(error.message);
  }

  async removeSongFromPlaylist(playlistId: string, songId: string): Promise<void> {
    const { error } = await this.client
      .from('playlist_songs')
      .delete()
      .eq('playlist_id', playlistId)
      .eq('song_id', songId);
    if (error) throw new Error(error.message);
  }

  // Rewrites the membership of one playlist, used when pushing a playlist
  // that was created or edited offline.
  async replacePlaylistSongs(playlistId: string, songIds: string[]): Promise<void> {
    const { error: clearError } = await this.client
      .from('playlist_songs')
      .delete()
      .eq('playlist_id', playlistId);
    if (clearError) throw new Error(clearError.message);
    if (!songIds.length) return;

    const rows = songIds.map((songId, position) => ({
      playlist_id: playlistId,
      song_id: songId,
      position,
    }));
    const { error } = await this.client.from('playlist_songs').insert(rows);
    if (error) throw new Error(error.message);
  }

  // --- Helpers ---

  recomputeUsage(rows: Pick<SongRow, 'size_bytes'>[]): void {
    this._usedBytes.set(rows.reduce((sum, row) => sum + (row.size_bytes ?? 0), 0));
  }

  // Keeps the quota bar honest between syncs, after an upload or a delete.
  addUsage(deltaBytes: number): void {
    this._usedBytes.update(bytes => Math.max(0, bytes + deltaBytes));
  }

  private extensionFor(file: Blob, song: SongModel): string {
    const fromName = file instanceof File ? file.name.split('.').pop() : undefined;
    if (fromName && fromName.length <= 5 && /^[a-z0-9]+$/i.test(fromName)) return fromName.toLowerCase();
    const fromType = file.type.split('/')[1]?.split(';')[0];
    if (fromType) return fromType === 'mpeg' ? 'mp3' : fromType;
    return song.storagePath?.split('.').pop() ?? 'mp3';
  }
}
