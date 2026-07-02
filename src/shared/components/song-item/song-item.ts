import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Cover } from '../../ui/cover/cover';
import { SongModel } from '../../models/song.model';

@Component({
  selector: 'app-song-item',
  standalone: true,
  imports: [CommonModule, Cover],
  templateUrl: './song-item.html',
  styleUrl: './song-item.scss',
})
export class SongItem {
  @Input({ required: true }) song!: SongModel;
  @Input() active = false;
  @Input() removable = true;
  @Output() play = new EventEmitter<void>();
  @Output() addToPlaylist = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();

  formatDuration(seconds: number): string {
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
