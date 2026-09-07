import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LibraryService } from '../../../shared/services/library.service';
import { PlayerService } from '../../../shared/services/player.service';
import { Cover } from '../../../shared/ui/cover/cover';

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

  constructor(public player: PlayerService, public library: LibraryService) {}

  // The queue closes with the player: leaving it open means it is still open
  // the next time the player is expanded, which hides the artwork for no reason.
  collapse(): void {
    this.showQueue.set(false);
    this.expanded.set(false);
  }

  onSeek(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.player.seek(+input.value);
  }

  format(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
