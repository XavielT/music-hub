import { Injectable, signal, computed } from '@angular/core';
import { LibraryService } from './library.service';
import { SongModel } from '../models/song.model';

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private audio = new Audio();
  private objectUrl: string | null = null;
  private queue: SongModel[] = [];
  private index = -1;

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
    this.audio.addEventListener('timeupdate', () => this._currentTime.set(this.audio.currentTime));
    this.audio.addEventListener('durationchange', () =>
      this._duration.set(isFinite(this.audio.duration) ? this.audio.duration : 0)
    );
    this.audio.addEventListener('play', () => this._isPlaying.set(true));
    this.audio.addEventListener('pause', () => this._isPlaying.set(false));
    this.audio.addEventListener('ended', () => this.next());
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
    await this.audio.play().catch(() => this._isPlaying.set(false));
  }
}
