import { Injectable, signal, computed } from '@angular/core';
import { MediaSession } from '@jofr/capacitor-media-session';
import { Capacitor } from '@capacitor/core';
import { LibraryService } from './library.service';
import { CloudLibraryService } from './cloud-library.service';
import { ToastService } from './toast.service';
import { SongModel } from '../models/song.model';

//  off : stop when the queue runs out
//  all : start the queue over (re-shuffled, when shuffle is on)
//  one : repeat the current song forever
export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueEntry {
  song: SongModel;
  position: number; // index into the play order, for jumpTo()
}

const PREFS_KEY = 'music-hub.player-prefs';

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private audio = new Audio();
  private objectUrl: string | null = null;
  private mediaSessionReady = false;

  // The queue holds the songs in the order they were handed to play().
  // `order` is a list of queue indices — the order they are actually played
  // in — so shuffling never loses the original sequence and switching shuffle
  // off restores it exactly.
  private _queue = signal<SongModel[]>([]);
  queue = this._queue.asReadonly();
  private _order = signal<number[]>([]);
  private _position = signal(-1);

  private _shuffle = signal(false);
  shuffle = this._shuffle.asReadonly();

  private _repeat = signal<RepeatMode>('off');
  repeat = this._repeat.asReadonly();

  private _current = signal<SongModel | null>(null);
  current = this._current.asReadonly();

  private _isPlaying = signal(false);
  isPlaying = this._isPlaying.asReadonly();

  private _currentTime = signal(0);
  currentTime = this._currentTime.asReadonly();

  private _duration = signal(0);
  duration = this._duration.asReadonly();

  progress = computed(() => (this._duration() > 0 ? this._currentTime() / this._duration() : 0));

  // What plays after the current song, already in play order.
  upNext = computed<QueueEntry[]>(() => {
    const queue = this._queue();
    const order = this._order();
    const position = this._position();
    if (position < 0) return [];
    return order
      .slice(position + 1)
      .map((queueIndex, offset) => ({ song: queue[queueIndex], position: position + 1 + offset }))
      .filter(entry => !!entry.song);
  });

  // Set when a song cannot be played right now (cloud audio, no connection).
  private _unavailable = signal<string | null>(null);
  unavailable = this._unavailable.asReadonly();

  constructor(
    private library: LibraryService,
    private cloud: CloudLibraryService,
    private toast: ToastService
  ) {
    this.loadPrefs();

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
    // `true` marks this as the queue advancing on its own, which is the only
    // case where the repeat mode has a say.
    this.audio.addEventListener('ended', () => this.next(true));

    this.setupMediaSession();
  }

  async play(song: SongModel, queue?: SongModel[]): Promise<void> {
    const list = queue?.length ? [...queue] : [song];
    const start = Math.max(0, list.findIndex(s => s.id === song.id));
    this._queue.set(list);
    this.reorder(list.length, start, this._shuffle());
    await this.loadAndPlay(song);
  }

  // "Shuffle play" entry point: turns shuffle on and starts somewhere random.
  async shufflePlay(songs: SongModel[]): Promise<void> {
    if (!songs.length) return;
    this._shuffle.set(true);
    this.savePrefs();
    const start = Math.floor(Math.random() * songs.length);
    this._queue.set([...songs]);
    this.reorder(songs.length, start, true);
    await this.loadAndPlay(songs[start]);
  }

  toggle(): void {
    if (!this._current()) return;
    if (this.audio.paused) this.audio.play().catch(() => this._isPlaying.set(false));
    else this.audio.pause();
  }

  toggleShuffle(): void {
    this.setShuffle(!this._shuffle());
  }

  // Re-orders what is left to play; the song playing right now keeps playing
  // and stays where it is, so the toggle is never audible mid-song.
  setShuffle(on: boolean): void {
    this._shuffle.set(on);
    this.savePrefs();
    const length = this._queue().length;
    if (!length) return;
    const currentQueueIndex = this._order()[this._position()] ?? 0;
    this.reorder(length, currentQueueIndex, on);
  }

  cycleRepeat(): void {
    const nextMode: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };
    this._repeat.set(nextMode[this._repeat()]);
    this.savePrefs();
  }

  // `auto` is true only when a song ended by itself. A tap on ⏭ always moves
  // on, even under repeat-one — otherwise the button would look broken.
  async next(auto = false): Promise<void> {
    const order = this._order();
    if (!order.length) return;

    if (auto && this._repeat() === 'one') {
      this.audio.currentTime = 0;
      await this.audio.play().catch(() => this._isPlaying.set(false));
      return;
    }

    const atEnd = this._position() >= order.length - 1;
    if (atEnd && auto && this._repeat() === 'off') {
      // End of the queue: stop on the last song rather than loop silently.
      this.audio.pause();
      this.seek(0);
      return;
    }

    if (!atEnd) {
      this._position.update(p => p + 1);
    } else {
      // Wrapping around. With shuffle on, deal a fresh order so the second
      // pass is not the same "random" sequence as the first.
      const length = this._queue().length;
      if (this._shuffle()) this.reorder(length, Math.floor(Math.random() * length), true);
      else this._position.set(0);
    }

    await this.playAtPosition();
  }

  async previous(): Promise<void> {
    const order = this._order();
    if (!order.length) return;
    if (this.audio.currentTime > 3) {
      this.seek(0);
      return;
    }
    this._position.set((this._position() - 1 + order.length) % order.length);
    await this.playAtPosition();
  }

  // Jump straight to an entry of the up-next list.
  async jumpTo(position: number): Promise<void> {
    const order = this._order();
    if (position < 0 || position >= order.length) return;
    this._position.set(position);
    await this.playAtPosition();
  }

  seek(time: number): void {
    this.audio.currentTime = time;
    this._currentTime.set(time);
    this.updatePositionState();
  }

  // Full teardown, used when the account changes: audio from the previous
  // user must not keep playing (or stay queued) for the next one.
  stop(): void {
    this.audio.pause();
    this.audio.removeAttribute('src');
    // Detaches the decoded stream; without it the WebView keeps the old
    // buffer (and the media notification) alive.
    this.audio.load();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this._queue.set([]);
    this._order.set([]);
    this._position.set(-1);
    this._current.set(null);
    this._isPlaying.set(false);
    this._currentTime.set(0);
    this._duration.set(0);
    this._unavailable.set(null);
    this.setPlaybackState('none');
  }

  // Builds the play order for a queue of `length` songs starting at
  // `startQueueIndex`, and points the position at that song.
  private reorder(length: number, startQueueIndex: number, shuffle: boolean): void {
    const indices = Array.from({ length }, (_, i) => i);
    if (!shuffle) {
      this._order.set(indices);
      this._position.set(startQueueIndex);
      return;
    }
    // Fisher-Yates over everything except the song that is playing, which is
    // pinned to the front so the shuffle starts from where the user is.
    const rest = indices.filter(i => i !== startQueueIndex);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this._order.set([startQueueIndex, ...rest]);
    this._position.set(0);
  }

  private async playAtPosition(): Promise<void> {
    const song = this._queue()[this._order()[this._position()]];
    if (song) await this.loadAndPlay(song);
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

  // Shuffle and repeat are a listening habit, not per-session state.
  private loadPrefs(): void {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw) as { shuffle?: boolean; repeat?: RepeatMode };
      this._shuffle.set(!!prefs.shuffle);
      if (prefs.repeat === 'all' || prefs.repeat === 'one') this._repeat.set(prefs.repeat);
    } catch {
      // Corrupt or unavailable storage: the defaults are fine.
    }
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ shuffle: this._shuffle(), repeat: this._repeat() })
      );
    } catch {
      // Private mode / storage full — not worth bothering the user about.
    }
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
