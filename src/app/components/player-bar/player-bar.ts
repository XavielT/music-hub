import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
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

  constructor(public player: PlayerService) {}

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
