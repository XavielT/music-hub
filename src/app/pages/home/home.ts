import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LibraryService } from '../../../shared/services/library.service';
import { PlayerService } from '../../../shared/services/player.service';
import { Cover } from '../../../shared/ui/cover/cover';
import { SongModel } from '../../../shared/models/song.model';
import { I18nService } from '../../../shared/services/i18n.service';
import { TPipe } from '../../../shared/i18n/t.pipe';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink, Cover, TPipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class HomeComponent {
  recent = computed(() => this.library.songs().slice(0, 10));

  constructor(
    public library: LibraryService,
    public player: PlayerService,
    private i18n: I18nService
  ) {}

  greeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return this.i18n.t('home.greetingMorning');
    if (hour < 19) return this.i18n.t('home.greetingAfternoon');
    return this.i18n.t('home.greetingEvening');
  }

  playSong(song: SongModel): void {
    this.player.play(song, this.library.songs());
  }
}
