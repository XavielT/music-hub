import { Injectable, signal, computed } from '@angular/core';
import { MediaSession } from '@jofr/capacitor-media-session';
import { Capacitor } from '@capacitor/core';
import { DbService } from './db.service';
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
  index: number; // position in queue(), for jumpTo/remove/move
}

// What is written back so the app can pick up where it was left.
interface SavedSession {
  songIds: string[];
  originalIds: string[];
  index: number;
  position: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

const PREFS_KEY = 'music-hub.player-prefs';
const VOLUME_KEY = 'music-hub.volume';
const SPEED_KEY = 'music-hub.speed';

// What the speed control offers. 1 is in the middle of the list on purpose:
// getting back to normal should not mean hunting for an end.
export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

// Sleep timer choices, in minutes. `end` is "when this song finishes", which
// is the one people actually reach for at night.
export type SleepChoice = number | 'end';
const SESSION_STORE = 'player';
const SESSION_KEY = 'session';
// Often enough that a crash loses seconds, rare enough to not thrash IndexedDB.
const SESSION_SAVE_INTERVAL_MS = 5000;

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private audio = new Audio();
  private objectUrl: string | null = null;
  private mediaSessionReady = false;
  private lastSessionSaveAt = 0;
  // Applied once the audio knows how long it is — setting currentTime before
  // metadata arrives is silently ignored.
  private pendingSeek: number | null = null;

  // The queue in the order it will actually play, which is what the queue
  // screen shows and what every index in this service refers to.
  private _queue = signal<SongModel[]>([]);
  queue = this._queue.asReadonly();

  private _queueIndex = signal(-1);
  queueIndex = this._queueIndex.asReadonly();

  // The order before shuffling, so turning shuffle off restores it exactly.
  private originalQueue: SongModel[] = [];

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

  private _volume = signal(1);
  volume = this._volume.asReadonly();

  private _speed = signal(1);
  speed = this._speed.asReadonly();

  // Milliseconds left on the sleep timer, or null when it is off. Counted down
  // from a wall-clock deadline rather than by decrementing, so a phone that
  // suspends its timers does not wake up owing time.
  private _sleepRemainingMs = signal<number | null>(null);
  sleepRemainingMs = this._sleepRemainingMs.asReadonly();

  // True when the timer is set to stop at the end of the current song.
  private _sleepAtEnd = signal(false);
  sleepAtEnd = this._sleepAtEnd.asReadonly();

  sleepArmed = computed(() => this._sleepAtEnd() || this._sleepRemainingMs() !== null);

  private sleepDeadline: number | null = null;
  private sleepTicker: ReturnType<typeof setInterval> | null = null;

  // Android has hardware buttons, and iOS Safari ignores assignments to
  // HTMLMediaElement.volume entirely — a slider there is a dead control.
  readonly volumeSupported = !Capacitor.isNativePlatform() && !isIosWeb();

  // Everything after the song playing now, with the index each one sits at.
  upNext = computed<QueueEntry[]>(() => {
    const queue = this._queue();
    const index = this._queueIndex();
    if (index < 0) return [];
    return queue.slice(index + 1).map((song, offset) => ({ song, index: index + 1 + offset }));
  });

  // Set when a song cannot be played right now (cloud audio, no connection).
  private _unavailable = signal<string | null>(null);
  unavailable = this._unavailable.asReadonly();

  constructor(
    private db: DbService,
    private library: LibraryService,
    private cloud: CloudLibraryService,
    private toast: ToastService
  ) {
    this.loadPrefs();

    // Keep audio alive in the background: the WebView needs an explicit
    // hint that this is media playback the user wants to continue.
    this.audio.setAttribute('playsinline', '');
    this.audio.preload = 'auto';
    this.audio.volume = this._volume();
    this.audio.playbackRate = this._speed();

    this.audio.addEventListener('timeupdate', () => {
      this._currentTime.set(this.audio.currentTime);
      this.updatePositionState();
      this.maybeSaveSession();
    });
    this.audio.addEventListener('loadedmetadata', () => {
      if (this.pendingSeek == null) return;
      // A restored position only becomes settable once the duration is known.
      this.audio.currentTime = Math.min(this.pendingSeek, this.audio.duration || this.pendingSeek);
      this._currentTime.set(this.audio.currentTime);
      this.pendingSeek = null;
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
      // Pausing is the moment the exact position is worth keeping.
      void this.saveSession();
    });
    // `true` marks this as the queue advancing on its own, which is the only
    // case where the repeat mode has a say.
    this.audio.addEventListener('ended', () => {
      // "Stop at the end of this song" outranks the repeat mode: under
      // repeat-one it would otherwise never arrive at an end at all.
      if (this._sleepAtEnd()) {
        this.clearSleepTimer();
        this.fallAsleep();
        this.seek(0);
        return;
      }
      void this.next(true);
    });

    this.setupMediaSession();
  }

  // --- playing ---

  // Unchanged signature: every existing caller hands over a song and the list
  // it came from.
  async play(song: SongModel, queue?: SongModel[]): Promise<void> {
    const list = queue?.length ? [...queue] : [song];
    const start = Math.max(
      0,
      list.findIndex(s => s.id === song.id)
    );
    this.originalQueue = [...list];

    if (this._shuffle()) {
      this._queue.set(shuffleKeepingFirst(list, start));
      await this.goTo(0, false);
    } else {
      this._queue.set(list);
      await this.goTo(start, false);
    }
  }

  // "Shuffle play" entry point: turns shuffle on and starts somewhere random.
  async shufflePlay(songs: SongModel[]): Promise<void> {
    if (!songs.length) return;
    this._shuffle.set(true);
    this.savePrefs();
    this.originalQueue = [...songs];
    this._queue.set(shuffleKeepingFirst(songs, Math.floor(Math.random() * songs.length)));
    await this.goTo(0, false);
  }

  toggle(): void {
    const song = this._current();
    if (!song) return;
    // A restored session, or a song that failed to load, has no source
    // attached yet — pressing play is the cue to go and get it.
    if (!this.audio.src) {
      void this.goTo(this._queueIndex(), false);
      return;
    }
    if (this.audio.paused) this.audio.play().catch(() => this._isPlaying.set(false));
    else this.audio.pause();
  }

  // `auto` is true only when a song ended by itself. A tap on ⏭ always moves
  // on, even under repeat-one — otherwise the button would look broken.
  async next(auto = false): Promise<void> {
    const queue = this._queue();
    if (!queue.length) return;

    if (auto && this._repeat() === 'one') {
      this.audio.currentTime = 0;
      await this.audio.play().catch(() => this._isPlaying.set(false));
      return;
    }

    const atEnd = this._queueIndex() >= queue.length - 1;
    if (atEnd && auto && this._repeat() === 'off') {
      // End of the queue: stop on the last song rather than loop silently.
      this.audio.pause();
      this.seek(0);
      return;
    }

    if (!atEnd) {
      await this.goTo(this._queueIndex() + 1, auto);
      return;
    }

    // Wrapping. With shuffle on, deal a fresh order so the second pass is not
    // the same "random" sequence as the first.
    if (this._shuffle()) {
      this._queue.set(shuffleKeepingFirst(queue, Math.floor(Math.random() * queue.length)));
    }
    await this.goTo(0, auto);
  }

  async previous(): Promise<void> {
    const queue = this._queue();
    if (!queue.length) return;
    if (this.audio.currentTime > 3) {
      this.seek(0);
      return;
    }
    const index = this._queueIndex();
    await this.goTo(index <= 0 ? queue.length - 1 : index - 1, false);
  }

  // Jump straight to an entry of the queue.
  async jumpTo(index: number): Promise<void> {
    if (index < 0 || index >= this._queue().length) return;
    await this.goTo(index, false);
  }

  seek(time: number): void {
    this.audio.currentTime = time;
    this._currentTime.set(time);
    this.updatePositionState();
  }

  setVolume(value: number): void {
    const clamped = Math.min(1, Math.max(0, value));
    this._volume.set(clamped);
    this.audio.volume = clamped;
    try {
      localStorage.setItem(VOLUME_KEY, String(clamped));
    } catch {
      // Private mode: the level lasts for this session only.
    }
  }

  // Playback speed. Kept across songs and across restarts, because it is a
  // way of listening rather than a property of one track — and it has to be
  // re-applied on every new source, since the element resets it.
  setSpeed(value: number): void {
    const clamped = Math.min(4, Math.max(0.25, value));
    this._speed.set(clamped);
    this.audio.playbackRate = clamped;
    try {
      localStorage.setItem(SPEED_KEY, String(clamped));
    } catch {
      // Private mode: the speed lasts for this session only.
    }
  }

  // Steps through PLAYBACK_SPEEDS, wrapping — one control rather than six.
  cycleSpeed(): void {
    const at = PLAYBACK_SPEEDS.indexOf(this._speed() as (typeof PLAYBACK_SPEEDS)[number]);
    const next = PLAYBACK_SPEEDS[(at + 1) % PLAYBACK_SPEEDS.length];
    this.setSpeed(next);
  }

  // --- sleep timer ---

  // `minutes` stops playback after that long; 'end' stops when the current
  // song finishes. Setting one replaces the other.
  setSleepTimer(choice: SleepChoice): void {
    this.clearSleepTimer();
    if (choice === 'end') {
      this._sleepAtEnd.set(true);
      return;
    }
    if (!(choice > 0)) return;

    // A deadline, not a countdown: a backgrounded WebView throttles intervals
    // to the point of stopping, and waking up with the full time left would
    // be the opposite of what a sleep timer is for.
    this.sleepDeadline = Date.now() + choice * 60_000;
    this._sleepRemainingMs.set(choice * 60_000);
    this.sleepTicker = setInterval(() => this.tickSleep(), 1000);
  }

  clearSleepTimer(): void {
    if (this.sleepTicker) clearInterval(this.sleepTicker);
    this.sleepTicker = null;
    this.sleepDeadline = null;
    this._sleepRemainingMs.set(null);
    this._sleepAtEnd.set(false);
  }

  private tickSleep(): void {
    if (this.sleepDeadline == null) return;
    const left = this.sleepDeadline - Date.now();
    if (left > 0) {
      this._sleepRemainingMs.set(left);
      return;
    }
    this.clearSleepTimer();
    this.fallAsleep();
  }

  // Pause rather than stop: the queue and the position stay exactly where they
  // were, so the morning is one tap from carrying on.
  private fallAsleep(): void {
    if (!this.audio.paused) this.audio.pause();
    this.toast.show('Sleep timer — playback paused.');
  }

  // --- queue editing ---

  // Straight after the song playing now.
  playNext(song: SongModel): void {
    if (!this._queue().length) {
      void this.play(song);
      return;
    }
    const at = this._queueIndex() + 1;
    this._queue.update(queue => insertAt(queue, at, song));
    this.originalQueue = insertAt(this.originalQueue, Math.min(at, this.originalQueue.length), song);
    void this.saveSession();
  }

  // At the end of the queue.
  addToQueue(song: SongModel): void {
    if (!this._queue().length) {
      void this.play(song);
      return;
    }
    this._queue.update(queue => [...queue, song]);
    this.originalQueue = [...this.originalQueue, song];
    void this.saveSession();
  }

  async removeFromQueue(index: number): Promise<void> {
    const queue = this._queue();
    if (index < 0 || index >= queue.length) return;
    const removed = queue[index];
    const next = queue.filter((_, i) => i !== index);
    this.originalQueue = this.originalQueue.filter(song => song !== removed);
    this._queue.set(next);

    const current = this._queueIndex();
    if (!next.length) {
      this.clearPlayback();
      void this.saveSession();
      return;
    }
    if (index < current) {
      this._queueIndex.set(current - 1);
    } else if (index === current) {
      // The song playing was removed, so the one that slid into its place
      // takes over rather than leaving silence.
      await this.goTo(Math.min(current, next.length - 1), false);
      return;
    }
    void this.saveSession();
  }

  moveInQueue(from: number, to: number): void {
    const queue = this._queue();
    if (from === to) return;
    if (from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
    const current = queue[this._queueIndex()];
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this._queue.set(next);
    // The song that is playing keeps playing, wherever it ended up.
    this._queueIndex.set(Math.max(0, next.indexOf(current)));
    void this.saveSession();
  }

  // --- modes ---

  toggleShuffle(): void {
    this.setShuffle(!this._shuffle());
  }

  // Re-orders what is left to play; the song playing right now keeps playing
  // and stays where it is, so the toggle is never audible mid-song.
  setShuffle(on: boolean): void {
    if (on === this._shuffle()) return;
    this._shuffle.set(on);
    this.savePrefs();

    const queue = this._queue();
    if (!queue.length) return;
    const current = queue[this._queueIndex()];

    if (on) {
      this.originalQueue = [...queue];
      this._queue.set(shuffleKeepingFirst(queue, this._queueIndex()));
      this._queueIndex.set(0);
    } else {
      // Songs added while shuffled are not in the saved order, and songs
      // removed while shuffled still are — reconcile both ways so nothing is
      // conjured up or lost by toggling.
      const restored = this.originalQueue.filter(song => queue.includes(song));
      for (const song of queue) if (!restored.includes(song)) restored.push(song);
      this._queue.set(restored);
      this._queueIndex.set(Math.max(0, restored.indexOf(current)));
    }
    void this.saveSession();
  }

  cycleRepeat(): void {
    const nextMode: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };
    this._repeat.set(nextMode[this._repeat()]);
    this.savePrefs();
    void this.saveSession();
  }

  // Full teardown, used when the account changes: audio from the previous
  // user must not keep playing (or stay queued) for the next one.
  stop(): void {
    this.clearSleepTimer();
    this.clearPlayback();
    this._queue.set([]);
    this.originalQueue = [];
    this._queueIndex.set(-1);
    // Deliberately not saved: the account this belonged to is going away, and
    // its database is about to be swapped out from under us.
  }

  private clearPlayback(): void {
    this.audio.pause();
    this.audio.removeAttribute('src');
    // Detaches the decoded stream; without it the WebView keeps the old
    // buffer (and the media notification) alive.
    this.audio.load();
    this.releaseObjectUrl();
    this.pendingSeek = null;
    this._current.set(null);
    this._isPlaying.set(false);
    this._currentTime.set(0);
    this._duration.set(0);
    this._unavailable.set(null);
    this.setPlaybackState('none');
  }

  /**
   * Plays the song at `index`, stepping past anything that cannot play right
   * now — a cloud song with no local copy and no connection.
   *
   * Silently skipping is the point: a queue of thirty songs where four are not
   * downloaded should play the other twenty-six, not stop dead on the fourth
   * with a toast per song. Only when nothing at all can play does it say so,
   * once.
   */
  private async goTo(index: number, auto: boolean): Promise<void> {
    const queue = this._queue();
    if (!queue.length || index < 0) return;

    let target = index;
    let skipped = 0;

    // Bounded by the queue length, so an all-unplayable queue ends rather than
    // spinning forever.
    for (let attempt = 0; attempt < queue.length; attempt++) {
      this.releaseObjectUrl();
      // The queue holds the songs as they were when it was built; a song
      // downloaded since then is playable now, and the library knows that.
      const song = this.freshest(queue[target]);
      const src = await this.resolveSource(song);
      if (src) {
        this.startPlayback(target, song, src);
        return;
      }

      skipped++;
      target++;
      if (target >= queue.length) {
        // Running off the end while skipping only wraps if wrapping is what
        // this queue does; otherwise there is nothing further to try.
        if (auto && this._repeat() === 'off') break;
        target = 0;
      }
      if (target === index) break; // all the way round
    }

    this.releaseObjectUrl();
    this.audio.pause();
    this._isPlaying.set(false);
    this._unavailable.set(queue[index]?.id ?? null);
    this.reportNothingPlayable(queue, index, skipped);
  }

  private reportNothingPlayable(queue: SongModel[], index: number, skipped: number): void {
    const song = queue[index];
    if (skipped <= 1 && song) {
      // A single song the user picked deserves to be told why.
      this.toast.error(
        song.storagePath || song.url
          ? `"${song.title}" needs a connection — download it with ⬇ to play it offline.`
          : `"${song.title}" could not be loaded.`
      );
      return;
    }
    this.toast.error(
      'Nothing left in the queue can play offline — download songs with ⬇ to listen without a connection.'
    );
  }

  private startPlayback(index: number, song: SongModel, src: string): void {
    this._queueIndex.set(index);
    this._unavailable.set(null);
    this._current.set(song);
    this.pendingSeek = null;
    this.audio.src = src;
    this.audio.volume = this._volume();
    // A new source resets the rate on the element, so it is set per song
    // rather than once.
    this.audio.playbackRate = this._speed();
    this.updateMetadata(song);
    void this.audio.play().catch(() => this._isPlaying.set(false));
    void this.saveSession();
  }

  // The library's copy of a song is the current one; the queue's may predate a
  // download or an artwork lookup.
  private freshest(song: SongModel): SongModel {
    return this.library.songs().find(s => s.id === song.id) ?? song;
  }

  // Offline-first: the local blob wins, then cloud storage, then a plain URL.
  private async resolveSource(song: SongModel): Promise<string | null> {
    if (!song) return null;
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

  private releaseObjectUrl(): void {
    if (!this.objectUrl) return;
    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  // --- resume where you left off ---

  /**
   * Rebuilds the last session: the queue, the song and where it had got to —
   * paused. Never autoplays: browsers block it without a gesture, and starting
   * music by itself when an app opens is rude even where it is allowed.
   */
  async restoreSession(): Promise<void> {
    let saved: SavedSession | undefined;
    try {
      saved = await this.db.get<SavedSession>(SESSION_STORE, SESSION_KEY);
    } catch {
      return; // nothing saved, or a database too old to have the store
    }
    if (!saved?.songIds?.length) return;
    // A queue is only meaningful once the library it points into is loaded.
    await this.library.whenReady();

    const byId = new Map(this.library.songs().map(song => [song.id, song]));
    const queue = saved.songIds.map(id => byId.get(id)).filter((s): s is SongModel => !!s);
    if (!queue.length) return; // every song in it has since been deleted

    this.originalQueue = (saved.originalIds ?? saved.songIds)
      .map(id => byId.get(id))
      .filter((s): s is SongModel => !!s);
    this._shuffle.set(!!saved.shuffle);
    this._repeat.set(saved.repeat ?? 'off');
    this._queue.set(queue);

    const index = Math.min(Math.max(0, saved.index ?? 0), queue.length - 1);
    this._queueIndex.set(index);
    const song = queue[index];
    this._current.set(song);
    this._duration.set(song.duration || 0);
    this._currentTime.set(saved.position || 0);

    // Attach the audio so pressing play starts instantly and at the right
    // place. If it cannot be resolved offline the song still shows, and
    // pressing play goes and looks for it properly.
    const src = await this.resolveSource(song);
    if (src) {
      this.pendingSeek = saved.position || 0;
      this.audio.src = src;
      this.audio.volume = this._volume();
      this.audio.load();
    }
    this.updateMetadata(song);
    this.setPlaybackState('paused');
    this.updatePositionState();
  }

  private maybeSaveSession(): void {
    const now = Date.now();
    if (now - this.lastSessionSaveAt < SESSION_SAVE_INTERVAL_MS) return;
    void this.saveSession();
  }

  private async saveSession(): Promise<void> {
    this.lastSessionSaveAt = Date.now();
    const queue = this._queue();
    try {
      if (!queue.length) {
        await this.db.delete(SESSION_STORE, SESSION_KEY);
        return;
      }
      const session: SavedSession = {
        songIds: queue.map(song => song.id),
        originalIds: this.originalQueue.map(song => song.id),
        index: Math.max(0, this._queueIndex()),
        position: this.audio.currentTime || 0,
        shuffle: this._shuffle(),
        repeat: this._repeat(),
      };
      await this.db.put(SESSION_STORE, session, SESSION_KEY);
    } catch {
      // Losing the resume point is not worth interrupting playback for.
    }
  }

  // Shuffle, repeat and volume are a listening habit, not per-session state,
  // and are wanted before any database is open — so they live in localStorage.
  private loadPrefs(): void {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const prefs = JSON.parse(raw) as { shuffle?: boolean; repeat?: RepeatMode };
        this._shuffle.set(!!prefs.shuffle);
        if (prefs.repeat === 'all' || prefs.repeat === 'one') this._repeat.set(prefs.repeat);
      }
      const volume = Number(localStorage.getItem(VOLUME_KEY));
      if (isFinite(volume) && volume >= 0 && volume <= 1) this._volume.set(volume);
      const speed = Number(localStorage.getItem(SPEED_KEY));
      if (isFinite(speed) && speed >= 0.25 && speed <= 4) this._speed.set(speed);
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
    const supported =
      Capacitor.isNativePlatform() || (typeof navigator !== 'undefined' && 'mediaSession' in navigator);
    if (!supported) return;

    this.safely(() => MediaSession.setActionHandler({ action: 'play' }, () => this.toggle()));
    this.safely(() => MediaSession.setActionHandler({ action: 'pause' }, () => this.toggle()));
    // These go through the same next/previous as the on-screen buttons, so the
    // lock screen follows the shuffled order rather than the original one.
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
    const artwork = this.library.coverSrc(song);
    this.safely(() =>
      MediaSession.setMetadata({
        title: song.title,
        artist: song.artist,
        album: song.album,
        artwork: artwork ? [{ src: artwork, sizes: '512x512', type: 'image/jpeg' }] : [],
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

// --- helpers ---

// Fisher-Yates over everything except the song at `keepIndex`, which is pinned
// to the front so a shuffle starts from where the listener already is.
export function shuffleKeepingFirst<T>(items: T[], keepIndex: number): T[] {
  const rest = items.filter((_, i) => i !== keepIndex);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const kept = items[keepIndex];
  return kept === undefined ? rest : [kept, ...rest];
}

function insertAt<T>(items: T[], index: number, item: T): T[] {
  const next = [...items];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

function isIosWeb(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
