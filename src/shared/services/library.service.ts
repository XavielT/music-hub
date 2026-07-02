import { Injectable, signal, computed } from '@angular/core';
import { DbService } from './db.service';
import { SongModel } from '../models/song.model';
import { PlaylistModel } from '../models/playlist.model';

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

  constructor(private db: DbService) {
    this.load();
  }

  private async load(): Promise<void> {
    const songs = await this.db.getAll<SongModel>('songs');
    const playlists = await this.db.getAll<PlaylistModel>('playlists');
    this._songs.set(songs.sort((a, b) => b.addedAt - a.addedAt));
    this._playlists.set(playlists.sort((a, b) => b.createdAt - a.createdAt));
    // TODO: pull shared library from Supabase (HttpClient / supabase-js) and merge with local songs
  }

  async addLocalSong(
    file: File,
    meta: { title: string; artist: string; album: string; coverUrl?: string; duration?: number }
  ): Promise<void> {
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
    };
    await this.db.put('files', file, song.id);
    await this.db.put('songs', song);
    this._songs.update(list => [song, ...list]);
    // TODO: upload audio to Supabase Storage so brother/cousins can stream it too
  }

  async addRemoteSong(url: string, meta: { title: string; artist: string; album: string }): Promise<void> {
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
    };
    await this.db.put('songs', song);
    this._songs.update(list => [song, ...list]);
  }

  async removeSong(id: string): Promise<void> {
    await this.db.delete('songs', id);
    await this.db.delete('files', id);
    this._songs.update(list => list.filter(s => s.id !== id));
    for (const p of this._playlists()) {
      if (p.songIds.includes(id)) await this.removeFromPlaylist(p.id, id);
    }
  }

  getSongFile(id: string): Promise<Blob | undefined> {
    return this.db.get<Blob>('files', id);
  }

  async createPlaylist(name: string): Promise<PlaylistModel> {
    const playlist: PlaylistModel = {
      id: crypto.randomUUID(),
      name,
      songIds: [],
      coverColor: this.pickColor(name),
      createdAt: Date.now(),
    };
    await this.db.put('playlists', playlist);
    this._playlists.update(list => [playlist, ...list]);
    return playlist;
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.db.delete('playlists', id);
    this._playlists.update(list => list.filter(p => p.id !== id));
  }

  async addToPlaylist(playlistId: string, songId: string): Promise<void> {
    const playlist = this._playlists().find(p => p.id === playlistId);
    if (!playlist || playlist.songIds.includes(songId)) return;
    const updated = { ...playlist, songIds: [...playlist.songIds, songId] };
    await this.db.put('playlists', updated);
    this._playlists.update(list => list.map(p => (p.id === playlistId ? updated : p)));
  }

  async removeFromPlaylist(playlistId: string, songId: string): Promise<void> {
    const playlist = this._playlists().find(p => p.id === playlistId);
    if (!playlist) return;
    const updated = { ...playlist, songIds: playlist.songIds.filter(id => id !== songId) };
    await this.db.put('playlists', updated);
    this._playlists.update(list => list.map(p => (p.id === playlistId ? updated : p)));
  }

  playlistSongs(playlist: PlaylistModel): SongModel[] {
    const all = this._songs();
    return playlist.songIds
      .map(id => all.find(s => s.id === id))
      .filter((s): s is SongModel => !!s);
  }

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
