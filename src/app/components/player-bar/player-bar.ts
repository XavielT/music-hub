import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LibraryService } from '../../../shared/services/library.service';
import { PlayerService, SleepChoice } from '../../../shared/services/player.service';
import { Cover } from '../../../shared/ui/cover/cover';

// A swipe has to be long enough not to be a tap that wandered, and clearly
// more horizontal than vertical (or the reverse) not to be the other gesture.
const SWIPE_MIN_PX = 45;
const SWIPE_AXIS_RATIO = 1.4;
// Past this it is a drag or a scroll, not a flick.
const SWIPE_MAX_MS = 700;

@Component({
  selector: 'app-player-bar',
  standalone: true,
  imports: [CommonModule, Cover],
  templateUrl: './player-bar.html',
  styleUrl: './player-bar.scss',
})
export class PlayerBar {
  expanded = signal(false);
  showQueue = signal(false);
  showSleep = signal(false);

  readonly sleepChoices: { label: string; value: SleepChoice }[] = [
    { label: '15 min', value: 15 },
    { label: '30 min', value: 30 },
    { label: '45 min', value: 45 },
    { label: '1 hour', value: 60 },
    { label: 'End of song', value: 'end' },
  ];

  repeatLabel = computed(() => {
    switch (this.player.repeat()) {
      case 'all':
        return 'Repeat queue';
      case 'one':
        return 'Repeat this song';
      default:
        return 'Repeat off';
    }
  });

  speedLabel = computed(() => `${this.player.speed()}×`);

  // "42 min" while it is counting, "End of song" when that is what was picked.
  sleepLabel = computed(() => {
    if (this.player.sleepAtEnd()) return 'End of song';
    const left = this.player.sleepRemainingMs();
    if (left == null) return 'Sleep';
    const minutes = Math.ceil(left / 60_000);
    return minutes > 1 ? `${minutes} min` : `${Math.ceil(left / 1000)} s`;
  });

  private touch: { x: number; y: number; at: number } | null = null;
  // A swipe ends in a click the browser sends anyway; this eats that one.
  private swallowClick = false;

  constructor(public player: PlayerService, public library: LibraryService) {}

  // The queue closes with the player: leaving it open means it is still open
  // the next time the player is expanded, which hides the artwork for no reason.
  collapse(): void {
    this.showQueue.set(false);
    this.showSleep.set(false);
    this.expanded.set(false);
  }

  // --- swipe ---

  onTouchStart(event: TouchEvent): void {
    const point = event.changedTouches[0];
    this.touch = point ? { x: point.clientX, y: point.clientY, at: Date.now() } : null;
  }

  // Left/right change the song, up opens the full player, down closes it —
  // the directions a mini player is already shaped like.
  onTouchEnd(event: TouchEvent, from: 'mini' | 'full'): void {
    const start = this.touch;
    this.touch = null;
    const point = event.changedTouches[0];
    if (!start || !point) return;
    if (Date.now() - start.at > SWIPE_MAX_MS) return;

    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;

    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * SWIPE_AXIS_RATIO) {
      this.swallowClick = true;
      if (dx < 0) void this.player.next();
      else void this.player.previous();
      return;
    }

    if (Math.abs(dy) >= SWIPE_MIN_PX && Math.abs(dy) > Math.abs(dx) * SWIPE_AXIS_RATIO) {
      this.swallowClick = true;
      if (dy < 0 && from === 'mini') this.expanded.set(true);
      if (dy > 0 && from === 'full') this.collapse();
    }
  }

  // Tapping the mini player opens it — unless that "tap" was the tail of a
  // swipe, which the browser reports as a click as well.
  onMiniClick(): void {
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }
    this.expanded.set(true);
  }

  // --- controls ---

  onVolume(event: Event): void {
    this.player.setVolume(+(event.target as HTMLInputElement).value);
  }

  onSeek(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.player.seek(+input.value);
  }

  pickSleep(choice: SleepChoice): void {
    this.player.setSleepTimer(choice);
    this.showSleep.set(false);
  }

  cancelSleep(): void {
    this.player.clearSleepTimer();
    this.showSleep.set(false);
  }

  format(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
