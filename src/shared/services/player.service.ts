import { Injectable, signal, computed } from '@angular/core';
import { MediaSession } from '@jofr/capacitor-media-session';
import { Capacitor } from '@capacitor/core';
import { LibraryService } from './library.service';
import { CloudLibraryService } from './cloud-library.service';
import { ToastService } from './toast.service';
import { SongModel } from '../models/song.model';

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private audio = new Audio();
  private objectUrl: string | null = null;
  private queue: SongModel[] = [];
  private index = -1;
  private mediaSessionReady = false;

  private _current = signal<SongModel | null>(null);
  current = this._current.asReadonly();

  private _isPlaying = signal(false);
  isPlaying = this._isPlaying.asReadonly();

  private _currentTime = signal(0);
  currentTime = this._currentTime.asReadonly();

  private _duration = signal(0);
  duration = this._duration.asReadonly();

  progress = computed(() => (this._duration() > 0 ? this._currentTime() / this._duration() : 0));

  // Set when a song cannot be played right now (cloud audio, no connection).
  private _unavailable = signal<string | null>(null);
  unavailable = this._unavailable.asReadonly();

  constructor(
    private library: LibraryService,
    private cloud: CloudLibraryService,
    private toast: ToastService
  ) {
    // Keep audio alive in the background: the WebView needs an explicit
    // hint that this is media playback the user wants to continue.
    this.audio.setAttribute('playsinline', '');
    this.audio.preload = 'auto';

    this.audio.addEventListener('timeupdate', () => {
      this._currentTime.set(this.audio.currentTime);
      this.updatePositionState();
    });
    this.audio.addEventListener('durationchange', () => {
      this._duration.set(isFinite(this.audio.duration) ? this.audio.duration : 0);
      this.updatePositionState();
    });
    this.audio.addEventListener('play', () => {
      this._isPlaying.set(true);
      this.setPlaybackState('playing');
    });
    this.audio.addEventListener('pause', () => {
      this._isPlaying.set(false);
      this.setPlaybackState('paused');
    });
    this.audio.addEventListener('ended', () => this.next());

    this.setupMediaSession();
  }

  async play(song: SongModel, queue?: SongModel[]): Promise<void> {
    this.queue = queue?.length ? [...queue] : [song];
    this.index = Math.max(0, this.queue.findIndex(s => s.id === song.id));
    await this.loadAndPlay(song);
  }

  toggle(): void {
    if (!this._current()) return;
    if (this.audio.paused) this.audio.play();
    else this.audio.pause();
  }

  async next(): Promise<void> {
    if (!this.queue.length) return;
    this.index = (this.index + 1) % this.queue.length;
    await this.loadAndPlay(this.queue[this.index]);
  }

  async previous(): Promise<void> {
    if (!this.queue.length) return;
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    this.index = (this.index - 1 + this.queue.length) % this.queue.length;
    await this.loadAndPlay(this.queue[this.index]);
  }

  seek(time: number): void {
    this.audio.currentTime = time;
    this.updatePositionState();
  }

  private async loadAndPlay(song: SongModel): Promise<void> {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this._unavailable.set(null);

    const src = await this.resolveSource(song);
    if (!src) {
      this._isPlaying.set(false);
      this._unavailable.set(song.id);
      // A cloud song with no local copy is the common case here, and
      // navigator.onLine cannot be trusted to tell us why it failed.
      this.toast.error(
        song.storagePath || song.url
          ? `"${song.title}" needs a connection — download it with ⬇ to play it offline.`
          : `"${song.title}" could not be loaded.`
      );
      return;
    }

    this._current.set(song);
    this.audio.src = src;
    this.updateMetadata(song);
    await this.audio.play().catch(() => this._isPlaying.set(false));
  }

  // Offline-first: the local blob wins, then cloud storage, then a plain URL.
  private async resolveSource(song: SongModel): Promise<string | null> {
    if (song.downloaded) {
      const blob = await this.library.getSongFile(song.id);
      if (blob) {
        this.objectUrl = URL.createObjectURL(blob);
        return this.objectUrl;
      }
    }

    if (song.storagePath) {
      if (!navigator.onLine) return null;
      try {
        return await this.cloud.getStreamUrl(song);
      } catch {
        return null;
      }
    }

    if (song.url) return navigator.onLine ? song.url : null;

    // Legacy local song whose blob went missing.
    return null;
  }

  // --- MediaSession: lock-screen / notification controls + background playback ---
  // Uses @jofr/capacitor-media-session: a real Android MediaSession +
  // media notification natively, and the Web MediaSession API on the browser.

  // These calls return promises, and on the web (notably iOS Safari) an
  // unsupported action rejects instead of throwing. Swallow each one on its
  // own so a single missing action cannot take down the rest — or surface as
  // an unhandled rejection.
  private safely(run: () => unknown): void {
    try {
      const result = run();
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // Platform does not support this call at all.
    }
  }

  private setupMediaSession(): void {
    // On Android the plugin talks to a real native MediaSession and
    // navigator.mediaSession does NOT exist in the WebView, so this must not
    // be gated on the web API — doing so silently kills the lock-screen
    // controls on the platform they were built for. On the web the plugin
    // wraps navigator.mediaSession, so there the check is the right one.
    const supported = Capacitor.isNativePlatform() || (typeof navigator !== 'undefined' && 'mediaSession' in navigator);
    if (!supported) return;

    this.safely(() => MediaSession.setActionHandler({ action: 'play' }, () => this.toggle()));
    this.safely(() => MediaSession.setActionHandler({ action: 'pause' }, () => this.toggle()));
    this.safely(() => MediaSession.setActionHandler({ action: 'previoustrack' }, () => this.previous()));
    this.safely(() => MediaSession.setActionHandler({ action: 'nexttrack' }, () => this.next()));
    this.safely(() =>
      MediaSession.setActionHandler({ action: 'seekto' }, details => {
        if (details.seekTime != null) this.seek(details.seekTime);
      })
    );
    this.mediaSessionReady = true;
  }

  private updateMetadata(song: SongModel): void {
    if (!this.mediaSessionReady) return;
    this.safely(() =>
      MediaSession.setMetadata({
        title: song.title,
        artist: song.artist,
        album: song.album,
        artwork: song.coverUrl
          ? [{ src: song.coverUrl, sizes: '512x512', type: 'image/jpeg' }]
          : [],
      })
    );
  }

  private setPlaybackState(state: 'playing' | 'paused' | 'none'): void {
    if (!this.mediaSessionReady) return;
    this.safely(() => MediaSession.setPlaybackState({ playbackState: state }));
  }

  private updatePositionState(): void {
    if (!this.mediaSessionReady) return;
    const duration = this.audio.duration;
    if (!isFinite(duration) || duration <= 0) return;
    // setPositionState rejects if the values are inconsistent — safe to skip.
    this.safely(() =>
      MediaSession.setPositionState({
        duration,
        position: Math.min(this.audio.currentTime, duration),
        playbackRate: this.audio.playbackRate || 1,
      })
    );
  }
}
