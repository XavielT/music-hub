import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LibraryService } from '../../../shared/services/library.service';
import { PlayerService } from '../../../shared/services/player.service';
import { Cover } from '../../../shared/ui/cover/cover';
import { SongModel } from '../../../shared/models/song.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink, Cover],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent {
  recent = computed(() => this.library.songs().slice(0, 10));

  constructor(public library: LibraryService, public player: PlayerService) {}

  greeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 19) return 'Good afternoon';
    return 'Good evening';
  }

  playSong(song: SongModel): void {
    this.player.play(song, this.library.songs());
  }
}
