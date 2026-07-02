import { Injectable, signal, computed } from '@angular/core';
import { MediaSession } from '@jofr/capacitor-media-session';
import { LibraryService } from './library.service';
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

  constructor(private library: LibraryService) {
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
    let src = song.url ?? '';
    if (song.source === 'local') {
      const blob = await this.library.getSongFile(song.id);
      if (!blob) return;
      this.objectUrl = URL.createObjectURL(blob);
      src = this.objectUrl;
    }
    this._current.set(song);
    this.audio.src = src;
    this.updateMetadata(song);
    await this.audio.play().catch(() => this._isPlaying.set(false));
  }

  // --- MediaSession: lock-screen / notification controls + background playback ---
  // Uses @jofr/capacitor-media-session: a real Android MediaSession +
  // media notification natively, and the Web MediaSession API on the browser.

  private setupMediaSession(): void {
    try {
      MediaSession.setActionHandler({ action: 'play' }, () => this.toggle());
      MediaSession.setActionHandler({ action: 'pause' }, () => this.toggle());
      MediaSession.setActionHandler({ action: 'previoustrack' }, () => this.previous());
      MediaSession.setActionHandler({ action: 'nexttrack' }, () => this.next());
      MediaSession.setActionHandler({ action: 'seekto' }, details => {
        if (details.seekTime != null) this.seek(details.seekTime);
      });
      this.mediaSessionReady = true;
    } catch {
      // Ignore unsupported actions on older platforms.
    }
  }

  private updateMetadata(song: SongModel): void {
    if (!this.mediaSessionReady) return;
    MediaSession.setMetadata({
      title: song.title,
      artist: song.artist,
      album: song.album,
      artwork: song.coverUrl
        ? [{ src: song.coverUrl, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });
  }

  private setPlaybackState(state: 'playing' | 'paused' | 'none'): void {
    if (this.mediaSessionReady) MediaSession.setPlaybackState({ playbackState: state });
  }

  private updatePositionState(): void {
    if (!this.mediaSessionReady) return;
    const duration = this.audio.duration;
    if (!isFinite(duration) || duration <= 0) return;
    try {
      MediaSession.setPositionState({
        duration,
        position: Math.min(this.audio.currentTime, duration),
        playbackRate: this.audio.playbackRate || 1,
      });
    } catch {
      // setPositionState throws if values are inconsistent — safe to skip.
    }
  }
}
