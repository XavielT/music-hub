import { Injectable, computed, effect, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { CloudLibraryService, isNetworkError } from './cloud-library.service';
import { LibraryService } from './library.service';
import { PlayerService } from './player.service';
import { ToastService } from './toast.service';
import { SongModel } from '../models/song.model';

export interface UploadProgress {
  done: number;
  total: number;
  title: string;
}

// Keeps the local library and Supabase in step. Pulls on login, pushes
// local-only songs on demand, and reconciles playlists edited offline.
@Injectable({ providedIn: 'root' })
export class SyncService {
  private _syncing = signal(false);
  syncing = this._syncing.asReadonly();

  private _lastSyncAt = signal<number | null>(null);
  lastSyncAt = this._lastSyncAt.asReadonly();

  private _uploadProgress = signal<UploadProgress | null>(null);
  uploadProgress = this._uploadProgress.asReadonly();

  uploading = computed(() => this._uploadProgress() !== null);

  private lastSyncedUserId: string | null = null;

  constructor(
    private auth: AuthService,
    private cloud: CloudLibraryService,
    private library: LibraryService,
    private player: PlayerService,
    private toast: ToastService
  ) {
    // The account is the unit of state here: the local database, the library
    // signals, the signed URLs and the player all belong to one user and all
    // have to turn over together when that user changes.
    effect(() => {
      const user = this.auth.user();
      if (!user) {
        this.lastSyncedUserId = null;
        this.closeAccount();
        return;
      }
      if (user.id === this.lastSyncedUserId) return;
      this.lastSyncedUserId = user.id;
      void this.openAccount(user.id);
    });

    // Coming back online is a good moment to reconcile.
    window.addEventListener('online', () => {
      if (this.auth.user()) void this.sync();
    });
  }

  // Load this account's own local library first, then reconcile with the
  // cloud. The order matters: syncing into the previous user's database would
  // hand them somebody else's songs (and delete their downloads).
  private async openAccount(userId: string): Promise<void> {
    this.closeAccount();
    await this.library.activate(userId);
    await this.sync();
  }

  // Everything that belongs to the account that is going away.
  private closeAccount(): void {
    this.player.stop();
    this.cloud.resetSession();
    this.library.deactivate();
    this._lastSyncAt.set(null);
  }

  private online(): boolean {
    return navigator.onLine;
  }

  // Pull cloud state and merge it into the local library.
  async sync(options: { silent?: boolean } = {}): Promise<void> {
    if (this._syncing() || !this.auth.user()) return;
    if (!this.online()) {
      if (!options.silent) this.toast.error('You are offline — showing the library stored on this device.');
      return;
    }

    this._syncing.set(true);
    try {
      await this.library.whenReady();

      const [songRows, playlistRows, playlistSongRows] = await Promise.all([
        this.cloud.listSongs(),
        this.cloud.listPlaylists(),
        this.cloud.listPlaylistSongs(),
      ]);

      for (const row of songRows) await this.library.applyRow(row);
      // Anything still marked synced but gone upstream was deleted elsewhere.
      await this.library.dropSyncedSongsMissingFrom(new Set(songRows.map(r => r.id)));

      for (const row of playlistRows) {
        await this.library.applyPlaylistRow(row, this.library.buildSongIds(row.id, playlistSongRows));
      }
      await this.library.dropSyncedPlaylistsMissingFrom(new Set(playlistRows.map(r => r.id)));

      await this.pushPendingPlaylists();

      this._lastSyncAt.set(Date.now());
    } catch (err) {
      // Local data is left exactly as it was.
      this.toast.error(
        isNetworkError(err)
          ? 'No connection — showing the library stored on this device.'
          : `Sync failed: ${(err as Error).message}`
      );
      console.warn('sync failed', err);
    } finally {
      this._syncing.set(false);
    }
  }

  // Playlists created or edited while offline are pushed wholesale.
  private async pushPendingPlaylists(): Promise<void> {
    const pending = this.library.playlists().filter(p => p.syncState === 'local-only');
    const syncedSongIds = new Set(
      this.library.songs().filter(s => s.syncState === 'synced').map(s => s.id)
    );

    for (const playlist of pending) {
      try {
        // playlist_songs has a FK to songs: only members that already exist
        // in the cloud can be pushed. The rest follow once they are uploaded.
        const songIds = playlist.songIds.filter(id => syncedSongIds.has(id));
        if (playlist.ownerId) await this.cloud.deletePlaylist(playlist.id).catch(() => undefined);
        await this.cloud.createPlaylist(playlist);
        await this.cloud.replacePlaylistSongs(playlist.id, songIds);
        await this.library.patchPlaylist(playlist.id, {
          ownerId: this.auth.user()!.id,
          syncState: 'synced',
        });
      } catch (err) {
        console.warn('pushing playlist failed', playlist.name, err);
      }
    }
  }

  // Sequentially upload every local-only song that has audio on this device.
  async uploadAll(): Promise<void> {
    const pending = this.library.localOnlySongs().filter(s => s.downloaded);
    if (!pending.length || this.uploading()) return;
    if (!this.online()) {
      this.toast.error('You are offline — uploads need a connection.');
      return;
    }

    let done = 0;
    let failed = 0;
    for (const song of pending) {
      this._uploadProgress.set({ done, total: pending.length, title: song.title });
      const ok = await this.library.uploadSong(song);
      if (!ok) failed++;
      done++;
    }
    this._uploadProgress.set(null);

    const uploaded = done - failed;
    if (uploaded > 0) {
      this.toast.show(`${uploaded} song${uploaded === 1 ? '' : 's'} uploaded to the cloud.`);
      // Playlists waiting on those songs can now be completed.
      await this.pushPendingPlaylists();
    }
    if (failed > 0) this.toast.error(`${failed} upload${failed === 1 ? '' : 's'} failed.`);
  }

  async uploadOne(song: SongModel): Promise<void> {
    if (!this.online()) {
      this.toast.error('You are offline — uploads need a connection.');
      return;
    }
    this._uploadProgress.set({ done: 0, total: 1, title: song.title });
    const ok = await this.library.uploadSong(song);
    this._uploadProgress.set(null);
    if (ok) {
      this.toast.show(`"${song.title}" is in the cloud.`);
      await this.pushPendingPlaylists();
    }
  }

  // Downloads every cloud song in a playlist for offline listening.
  async downloadPlaylist(songs: SongModel[]): Promise<void> {
    const pending = songs.filter(s => !s.downloaded && s.storagePath);
    if (!pending.length) return;
    if (!this.online()) {
      this.toast.error('You are offline — downloads need a connection.');
      return;
    }

    let done = 0;
    for (const song of pending) {
      this._uploadProgress.set({ done, total: pending.length, title: song.title });
      await this.library.downloadSong(song);
      done++;
    }
    this._uploadProgress.set(null);
    this.toast.show(`${done} song${done === 1 ? '' : 's'} available offline.`);
  }
}
