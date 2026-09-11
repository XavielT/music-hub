import { Injectable, computed, effect, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { CloudLibraryService, isNetworkError } from './cloud-library.service';
import { LibraryService } from './library.service';
import { PlayerService } from './player.service';
import { RealtimeService } from './realtime.service';
import { AppSettingsService } from './app-settings.service';
import { DownloadQueueService } from './download-queue.service';
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

  // A change landed upstream while a sync was already running. That sync may
  // have read its rows before the change existed, so another pass is owed.
  private resyncQueued = false;

  constructor(
    private auth: AuthService,
    private cloud: CloudLibraryService,
    private library: LibraryService,
    private player: PlayerService,
    private realtime: RealtimeService,
    private queue: DownloadQueueService,
    private toast: ToastService,
    private settings: AppSettingsService
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
    // Before the network call, so the mini player is back with the last song
    // the moment the library is on screen rather than after a sync round trip.
    await this.player.restoreSession();
    await this.sync();
    // After the first reconciliation, not before: the channel only has to
    // report what changes from here on, and starting it earlier would make it
    // race the pull it would be asking for anyway.
    this.realtime.start(() => void this.sync({ silent: true }));
    // Requests other members left while this device was closed are waiting;
    // start() loads them and, on an admin device with a companion, begins
    // working through them.
    this.queue.start();
    // The admin's limits, refreshed per account rather than per upload. The
    // cached copy covers the gap and an offline start.
    void this.settings.load();
  }

  // Everything that belongs to the account that is going away.
  private closeAccount(): void {
    this.realtime.stop();
    this.queue.stop();
    this.player.stop();
    this.cloud.resetSession();
    this.library.deactivate();
    this.resyncQueued = false;
    this._lastSyncAt.set(null);
  }

  private online(): boolean {
    return navigator.onLine;
  }

  // Pull cloud state and merge it into the local library.
  //
  // `silent` marks a sync the user did not ask for — the live channel firing,
  // or a reconnect. Those report nothing: a background pull that cannot reach
  // the network is not news, and a toast for it would arrive out of nowhere
  // while the user is doing something else.
  async sync(options: { silent?: boolean } = {}): Promise<void> {
    if (!this.auth.user()) return;
    if (this._syncing()) {
      this.resyncQueued = true;
      return;
    }
    if (!this.online()) {
      if (!options.silent) this.toast.error('You are offline — showing the library stored on this device.');
      return;
    }

    this._syncing.set(true);
    try {
      await this.library.whenReady();

      const [songRows, playlistRows, playlistSongRows, profiles] = await Promise.all([
        this.cloud.listSongs(),
        this.cloud.listPlaylists(),
        this.cloud.listPlaylistSongs(),
        // Only needed to put a name on a playlist somebody else shared, so a
        // failure here must not cost the rest of the sync.
        this.cloud.listProfiles().catch(() => []),
      ]);

      // Before the playlists: applyPlaylistRow stores the owner's name on the
      // playlist as it goes, so the map has to be in place first.
      this.library.setPeople(profiles);

      for (const row of songRows) await this.library.applyRow(row);
      // Anything still marked synced but gone upstream was deleted elsewhere.
      await this.library.dropSyncedSongsMissingFrom(new Set(songRows.map(r => r.id)));

      for (const row of playlistRows) {
        await this.library.applyPlaylistRow(row, this.library.buildSongIds(row.id, playlistSongRows));
      }
      await this.library.dropSyncedPlaylistsMissingFrom(new Set(playlistRows.map(r => r.id)));

      await this.library.pushDirtySongs();
      await this.pushPendingPlaylists();

      this._lastSyncAt.set(Date.now());
    } catch (err) {
      // Local data is left exactly as it was.
      if (!options.silent) {
        this.toast.error(
          isNetworkError(err)
            ? 'No connection — showing the library stored on this device.'
            : `Sync failed: ${(err as Error).message}`
        );
      }
      console.warn('sync failed', err);
    } finally {
      this._syncing.set(false);
      if (this.resyncQueued) {
        this.resyncQueued = false;
        // Silent whatever the caller was: the user already saw the result of
        // the sync they asked for, and this pass is for the change that
        // arrived behind it.
        void this.sync({ silent: true });
      }
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
        // Somebody else's shared playlist: the songs in it are open to
        // everyone, the playlist itself is not. Pushing its name or its
        // sharing back would be refused by the policy anyway.
        if (this.library.isMine(playlist)) await this.cloud.upsertPlaylist(playlist);
        await this.cloud.replacePlaylistSongs(playlist.id, songIds);
        await this.library.patchPlaylist(playlist.id, {
          ownerId: playlist.ownerId || this.auth.user()!.id,
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
      await this.library.pushDirtySongs();
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
      await this.library.pushDirtySongs();
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
