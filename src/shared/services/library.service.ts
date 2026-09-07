import { Injectable, signal, computed } from '@angular/core';
import { DbService } from './db.service';
import {
  CloudLibraryService,
  PlaylistRow,
  PlaylistSongRow,
  SongRow,
  STORAGE_QUOTA_BYTES,
  isNetworkError,
} from './cloud-library.service';
import { ToastService } from './toast.service';
import { SongModel, normalizeSong } from '../models/song.model';
import { PlaylistModel, normalizePlaylist } from '../models/playlist.model';

export interface SongGroup {
  name: string;
  songs: SongModel[];
}

const COVER_COLORS = ['#ff9000', '#ff5f00', '#e91e63', '#9c27b0', '#3f51b5', '#03a9f4', '#009688', '#8bc34a'];

@Injectable({ providedIn: 'root' })
export class LibraryService {
  private _songs = signal<SongModel[]>([]);
  songs = this._songs.asReadonly();

  private _playlists = signal<PlaylistModel[]>([]);
  playlists = this._playlists.asReadonly();

  artists = computed(() => this.groupBy(this._songs(), s => s.artist));
  albums = computed(() => this.groupBy(this._songs(), s => s.album));

  // Songs that exist only on this device and could be pushed to the cloud.
  localOnlySongs = computed(() => this._songs().filter(s => s.syncState === 'local-only'));

  // Resolves once the signed-in user's library has been read off IndexedDB.
  // Nothing is loaded until `activate()` names the account to load.
  private ready: Promise<void> = Promise.resolve();

  constructor(
    private db: DbService,
    private cloud: CloudLibraryService,
    private toast: ToastService
  ) {}

  whenReady(): Promise<void> {
    return this.ready;
  }

  // Points the local store at one account and reads its library in. Must run
  // before anything touches the library — SyncService's auth effect does it.
  activate(userId: string): Promise<void> {
    this.ready = (async () => {
      await this.db.use(userId);
      await this.load();
    })();
    return this.ready;
  }

  // Signing out has to land on an empty UI, not the previous user's library.
  deactivate(): void {
    this._songs.set([]);
    this._playlists.set([]);
    this.ready = Promise.resolve();
  }

  private async load(): Promise<void> {
    const [rawSongs, rawPlaylists, fileKeys] = await Promise.all([
      this.db.getAll<SongModel>('songs'),
      this.db.getAll<PlaylistModel>('playlists'),
      this.db.getAllKeys('files'),
    ]);

    // Migration: songs saved before the cloud fields existed get defaults,
    // and `downloaded` is derived from whether the blob is really here.
    const blobIds = new Set(fileKeys.map(String));
    const stale: SongModel[] = [];
    const songs = rawSongs.map(raw => {
      const song = normalizeSong(raw, blobIds.has(raw.id));
      // Only rewrite rows that were actually missing cloud fields, or whose
      // `downloaded` flag no longer matches what is on disk.
      if (
        raw.syncState === undefined ||
        raw.ownerId === undefined ||
        raw.sizeBytes === undefined ||
        raw.downloaded !== song.downloaded
      ) {
        stale.push(song);
      }
      return song;
    });

    const stalePlaylists: PlaylistModel[] = [];
    const playlists = rawPlaylists.map(raw => {
      const playlist = normalizePlaylist(raw);
      if (raw.syncState === undefined || raw.ownerId === undefined) stalePlaylists.push(playlist);
      return playlist;
    });

    this._songs.set([...songs].sort((a, b) => b.addedAt - a.addedAt));
    this._playlists.set([...playlists].sort((a, b) => b.createdAt - a.createdAt));

    // Persist the migrated shape so this only happens once.
    await Promise.all([
      ...stale.map(song => this.db.put('songs', song)),
      ...stalePlaylists.map(playlist => this.db.put('playlists', playlist)),
    ]);
  }

  private online(): boolean {
    return navigator.onLine;
  }

  // --- Songs ---

  async addLocalSong(
    file: File,
    meta: { title: string; artist: string; album: string; coverUrl?: string; duration?: number },
    uploadToCloud = false
  ): Promise<SongModel> {
    const song: SongModel = {
      id: crypto.randomUUID(),
      title: meta.title || file.name,
      artist: meta.artist || 'Unknown artist',
      album: meta.album || 'Unknown album',
      coverUrl: meta.coverUrl,
      duration: meta.duration || (await this.readDuration(file)),
      source: 'local',
      coverColor: this.pickColor(meta.artist + meta.title),
      addedAt: Date.now(),
      ownerId: '',
      sizeBytes: file.size,
      syncState: 'local-only',
      downloaded: true,
    };
    await this.db.put('files', file, song.id);
    await this.db.put('songs', song);
    this._songs.update(list => [song, ...list]);

    if (uploadToCloud && this.online()) await this.uploadSong(song);
    return song;
  }

  async addRemoteSong(url: string, meta: { title: string; artist: string; album: string }): Promise<SongModel> {
    const song: SongModel = {
      id: crypto.randomUUID(),
      title: meta.title || url,
      artist: meta.artist || 'Unknown artist',
      album: meta.album || 'Unknown album',
      duration: 0,
      source: 'remote',
      url,
      coverColor: this.pickColor(meta.artist + meta.title),
      addedAt: Date.now(),
      ownerId: '',
      sizeBytes: 0,
      syncState: 'local-only',
      downloaded: false,
    };
    await this.db.put('songs', song);
    this._songs.update(list => [song, ...list]);

    // A URL song is just a row in the cloud — nothing to upload.
    if (this.online()) {
      try {
        const row = await this.cloud.insertRemoteSong(song, url);
        await this.applyRow(row, false);
      } catch (err) {
        this.toast.error(`Could not save "${song.title}" to the cloud. It stays on this device.`);
        console.warn('insertRemoteSong failed', err);
      }
    }
    return song;
  }

  // Pushes one local-only song (and its audio) to Supabase.
  async uploadSong(song: SongModel): Promise<boolean> {
    if (song.syncState === 'synced' || song.syncState === 'uploading') return true;

    const file = await this.getSongFile(song.id);
    if (!file) {
      this.toast.error(`"${song.title}" has no audio on this device, so it cannot be uploaded.`);
      return false;
    }

    // Running head-first into the 1 GB wall fails with a raw storage error,
    // so the quota is checked before a single byte goes up.
    if (this.cloud.usedBytes() + file.size > STORAGE_QUOTA_BYTES) {
      this.toast.error(
        `Cloud storage is full — 1 GB limit reached, so "${song.title}" stays on this device. Delete a cloud song to make room.`
      );
      return false;
    }

    await this.patchSong(song.id, { syncState: 'uploading' });
    try {
      const row = await this.cloud.uploadSong(file, song);
      await this.applyRow(row, true);
      this.cloud.addUsage(row.size_bytes);
      return true;
    } catch (err) {
      // The local copy is untouched: it simply stays local-only.
      await this.patchSong(song.id, { syncState: 'local-only' });
      this.toast.error(
        isNetworkError(err)
          ? `No connection — "${song.title}" stays on this device. Tap ↑ to retry later.`
          : `Upload of "${song.title}" failed: ${(err as Error).message}`
      );
      console.warn('uploadSong failed', err);
      return false;
    }
  }

  // Fetches the cloud audio and keeps it in IndexedDB for offline playback.
  async downloadSong(song: SongModel): Promise<boolean> {
    if (song.downloaded || !song.storagePath) return song.downloaded;

    await this.patchSong(song.id, { syncState: 'downloading' });
    try {
      const blob = await this.cloud.downloadAudio(song);
      await this.db.put('files', blob, song.id);
      await this.patchSong(song.id, { syncState: 'synced', downloaded: true });
      return true;
    } catch (err) {
      await this.patchSong(song.id, { syncState: 'synced' });
      this.toast.error(
        isNetworkError(err)
          ? `No connection — "${song.title}" could not be downloaded.`
          : `Could not download "${song.title}".`
      );
      console.warn('downloadSong failed', err);
      return false;
    }
  }

  // Frees the local blob but keeps the cloud song listed.
  async removeDownload(song: SongModel): Promise<void> {
    if (song.syncState !== 'synced') {
      this.toast.error('This song is only on this device — uploading it first would delete it for good.');
      return;
    }
    await this.db.delete('files', song.id);
    await this.patchSong(song.id, { downloaded: false });
  }

  async removeSong(id: string): Promise<void> {
    const song = this._songs().find(s => s.id === id);
    if (song?.syncState === 'synced' && this.online()) {
      try {
        await this.cloud.deleteSong(song);
        this.cloud.addUsage(-song.sizeBytes);
      } catch (err) {
        this.toast.error(`Could not delete "${song.title}" from the cloud.`);
        console.warn('deleteSong failed', err);
        return; // keep it locally rather than drift out of sync
      }
    } else if (song?.syncState === 'synced') {
      this.toast.error('You are offline — delete this song again when you have a connection.');
      return;
    }

    await this.forgetSongLocally(id);
    for (const p of this._playlists()) {
      if (p.songIds.includes(id)) await this.removeFromPlaylist(p.id, id);
    }
  }

  // Drops a song from this device without touching the cloud.
  async forgetSongLocally(id: string): Promise<void> {
    await this.db.delete('songs', id);
    await this.db.delete('files', id);
    this._songs.update(list => list.filter(s => s.id !== id));
  }

  getSongFile(id: string): Promise<Blob | undefined> {
    return this.db.get<Blob>('files', id);
  }

  // --- Playlists ---

  async createPlaylist(name: string): Promise<PlaylistModel> {
    const playlist: PlaylistModel = {
      id: crypto.randomUUID(),
      name,
      songIds: [],
      coverColor: this.pickColor(name),
      createdAt: Date.now(),
      ownerId: '',
      syncState: 'local-only',
    };
    await this.db.put('playlists', playlist);
    this._playlists.update(list => [playlist, ...list]);

    // Optimistic: the playlist is usable immediately, the write follows.
    if (this.online()) {
      try {
        const row = await this.cloud.createPlaylist(playlist);
        await this.patchPlaylist(playlist.id, { ownerId: row.owner_id, syncState: 'synced' });
      } catch (err) {
        this.toast.error(`"${name}" was created on this device only.`);
        console.warn('createPlaylist failed', err);
      }
    }
    return playlist;
  }

  async deletePlaylist(id: string): Promise<void> {
    const playlist = this._playlists().find(p => p.id === id);
    await this.db.delete('playlists', id);
    this._playlists.update(list => list.filter(p => p.id !== id));

    if (playlist?.syncState === 'synced' && this.online()) {
      try {
        await this.cloud.deletePlaylist(id);
      } catch (err) {
        this.toast.error('The playlist was removed here but not in the cloud.');
        console.warn('deletePlaylist failed', err);
      }
    }
  }

  async addToPlaylist(playlistId: string, songId: string): Promise<void> {
    const playlist = this._playlists().find(p => p.id === playlistId);
    if (!playlist || playlist.songIds.includes(songId)) return;

    // playlist_songs has a foreign key to songs: a song that is not in the
    // cloud yet cannot be referenced there. Keep it local and let the next
    // sync push the whole membership once the song has been uploaded.
    const song = this._songs().find(s => s.id === songId);
    const songIds = [...playlist.songIds, songId];
    await this.writePlaylistSongs(
      playlist,
      songIds,
      () => this.cloud.addSongToPlaylist(playlistId, songId, songIds.length - 1),
      song?.syncState === 'synced'
    );
  }

  async removeFromPlaylist(playlistId: string, songId: string): Promise<void> {
    const playlist = this._playlists().find(p => p.id === playlistId);
    if (!playlist || !playlist.songIds.includes(songId)) return;

    const songIds = playlist.songIds.filter(id => id !== songId);
    await this.writePlaylistSongs(playlist, songIds, () =>
      this.cloud.removeSongFromPlaylist(playlistId, songId)
    );
  }

  // Applies a membership change locally first, then mirrors it to the cloud.
  // A failed or offline write marks the playlist local-only so the next sync
  // pushes the whole list back up.
  private async writePlaylistSongs(
    playlist: PlaylistModel,
    songIds: string[],
    cloudWrite: () => Promise<void>,
    songIsInCloud = true
  ): Promise<void> {
    const canPush = playlist.syncState === 'synced' && this.online() && songIsInCloud;
    await this.patchPlaylist(playlist.id, {
      songIds,
      syncState: canPush ? 'synced' : 'local-only',
    });
    if (!canPush) return;

    try {
      await cloudWrite();
    } catch (err) {
      await this.patchPlaylist(playlist.id, { syncState: 'local-only' });
      console.warn('playlist song write failed', err);
    }
  }

  playlistSongs(playlist: PlaylistModel): SongModel[] {
    const all = this._songs();
    return playlist.songIds
      .map(id => all.find(s => s.id === id))
      .filter((s): s is SongModel => !!s);
  }

  // --- Merge helpers used by SyncService ---

  // Writes one cloud row into local state, keeping device-only facts
  // (whether the blob is here) intact.
  async applyRow(row: SongRow, downloadedHint?: boolean): Promise<SongModel> {
    const existing = this._songs().find(s => s.id === row.id);
    const song: SongModel = {
      id: row.id,
      title: row.title,
      artist: row.artist,
      album: row.album,
      duration: row.duration,
      source: row.remote_url ? 'remote' : 'local',
      url: row.remote_url ?? undefined,
      coverUrl: row.cover_url ?? undefined,
      coverColor: row.cover_color,
      addedAt: existing?.addedAt ?? (Date.parse(row.created_at) || Date.now()),
      ownerId: row.owner_id,
      storagePath: row.storage_path ?? undefined,
      sizeBytes: row.size_bytes,
      syncState: 'synced',
      downloaded: downloadedHint ?? existing?.downloaded ?? false,
    };
    await this.db.put('songs', song);
    this._songs.update(list => {
      const next = list.some(s => s.id === song.id)
        ? list.map(s => (s.id === song.id ? song : s))
        : [song, ...list];
      return next.sort((a, b) => b.addedAt - a.addedAt);
    });
    return song;
  }

  async applyPlaylistRow(row: PlaylistRow, songIds: string[]): Promise<void> {
    const existing = this._playlists().find(p => p.id === row.id);
    const playlist: PlaylistModel = {
      id: row.id,
      name: row.name,
      songIds,
      coverColor: row.cover_color,
      createdAt: existing?.createdAt ?? (Date.parse(row.created_at) || Date.now()),
      ownerId: row.owner_id,
      syncState: 'synced',
    };
    await this.db.put('playlists', playlist);
    this._playlists.update(list => {
      const next = list.some(p => p.id === playlist.id)
        ? list.map(p => (p.id === playlist.id ? playlist : p))
        : [playlist, ...list];
      return next.sort((a, b) => b.createdAt - a.createdAt);
    });
  }

  async patchSong(id: string, patch: Partial<SongModel>): Promise<void> {
    const song = this._songs().find(s => s.id === id);
    if (!song) return;
    const updated = { ...song, ...patch };
    await this.db.put('songs', updated);
    this._songs.update(list => list.map(s => (s.id === id ? updated : s)));
  }

  async patchPlaylist(id: string, patch: Partial<PlaylistModel>): Promise<void> {
    const playlist = this._playlists().find(p => p.id === id);
    if (!playlist) return;
    const updated = { ...playlist, ...patch };
    await this.db.put('playlists', updated);
    this._playlists.update(list => list.map(p => (p.id === id ? updated : p)));
  }

  // Cloud is the source of truth for synced rows: one that is gone upstream
  // was deleted on another device. Local-only songs are never touched.
  async dropSyncedSongsMissingFrom(cloudIds: Set<string>): Promise<void> {
    const orphans = this._songs().filter(s => s.syncState === 'synced' && !cloudIds.has(s.id));
    for (const song of orphans) await this.forgetSongLocally(song.id);
  }

  async dropSyncedPlaylistsMissingFrom(cloudIds: Set<string>): Promise<void> {
    const orphans = this._playlists().filter(p => p.syncState === 'synced' && !cloudIds.has(p.id));
    for (const playlist of orphans) {
      await this.db.delete('playlists', playlist.id);
      this._playlists.update(list => list.filter(p => p.id !== playlist.id));
    }
  }

  buildSongIds(playlistId: string, rows: PlaylistSongRow[]): string[] {
    return rows
      .filter(r => r.playlist_id === playlistId)
      .sort((a, b) => a.position - b.position)
      .map(r => r.song_id);
  }

  // --- Internals ---

  private groupBy(songs: SongModel[], key: (s: SongModel) => string): SongGroup[] {
    const map = new Map<string, SongModel[]>();
    for (const song of songs) {
      const name = key(song);
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(song);
    }
    return [...map.entries()]
      .map(([name, list]) => ({ name, songs: list }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private pickColor(seed: string): string {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    return COVER_COLORS[Math.abs(hash) % COVER_COLORS.length];
  }

  private readDuration(file: File): Promise<number> {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(isFinite(audio.duration) ? Math.round(audio.duration) : 0);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
      audio.src = url;
    });
  }
}
