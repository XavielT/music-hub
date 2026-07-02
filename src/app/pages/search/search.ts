import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LibraryService } from '../../../shared/services/library.service';
import { PlayerService } from '../../../shared/services/player.service';
import { SongItem } from '../../../shared/components/song-item/song-item';
import { PlaylistPicker } from '../../../shared/components/playlist-picker/playlist-picker';
import { SongModel } from '../../../shared/models/song.model';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, SongItem, PlaylistPicker],
  templateUrl: './search.html',
  styleUrl: './search.scss',
})
export class SearchComponent {
  query = signal('');
  pickerFor = signal<SongModel | null>(null);

  results = computed(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return this.library.songs();
    return this.library
      .songs()
      .filter(
        s =>
          s.title.toLowerCase().includes(q) ||
          s.artist.toLowerCase().includes(q) ||
          s.album.toLowerCase().includes(q)
      );
  });

  constructor(public library: LibraryService, public player: PlayerService) {}

  onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  async onPicked(playlistId: string): Promise<void> {
    const song = this.pickerFor();
    if (song) await this.library.addToPlaylist(playlistId, song.id);
    this.pickerFor.set(null);
  }
}
