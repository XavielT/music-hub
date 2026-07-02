import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LibraryService, SongGroup } from '../../../shared/services/library.service';
import { PlayerService } from '../../../shared/services/player.service';
import { SongItem } from '../../../shared/components/song-item/song-item';
import { PlaylistPicker } from '../../../shared/components/playlist-picker/playlist-picker';
import { Cover } from '../../../shared/ui/cover/cover';
import { SongModel } from '../../../shared/models/song.model';

type LibraryTab = 'songs' | 'artists' | 'albums' | 'playlists';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, SongItem, PlaylistPicker, Cover],
  templateUrl: './library.html',
  styleUrl: './library.scss',
})
export class LibraryComponent {
  tab = signal<LibraryTab>('songs');
  selectedGroup = signal<SongGroup | null>(null);
  pickerFor = signal<SongModel | null>(null);
  newPlaylistName = '';

  tabs: LibraryTab[] = ['songs', 'artists', 'albums', 'playlists'];

  groups = computed(() => (this.tab() === 'artists' ? this.library.artists() : this.library.albums()));

  constructor(public library: LibraryService, public player: PlayerService) {}

  setTab(tab: LibraryTab): void {
    this.tab.set(tab);
    this.selectedGroup.set(null);
  }

  async createPlaylist(): Promise<void> {
    const name = this.newPlaylistName.trim();
    if (!name) return;
    await this.library.createPlaylist(name);
    this.newPlaylistName = '';
  }

  async onPicked(playlistId: string): Promise<void> {
    const song = this.pickerFor();
    if (song) await this.library.addToPlaylist(playlistId, song.id);
    this.pickerFor.set(null);
  }
}
