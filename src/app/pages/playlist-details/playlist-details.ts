import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { LibraryService } from '../../../shared/services/library.service';
import { PlayerService } from '../../../shared/services/player.service';
import { SongItem } from '../../../shared/components/song-item/song-item';
import { Cover } from '../../../shared/ui/cover/cover';

@Component({
  selector: 'app-playlist-details',
  standalone: true,
  imports: [CommonModule, SongItem, Cover],
  templateUrl: './playlist-details.html',
  styleUrl: './playlist-details.scss',
})
export class PlaylistDetailsComponent {
  private id: string;

  playlist = computed(() => this.library.playlists().find(p => p.id === this.id) ?? null);
  songs = computed(() => {
    const p = this.playlist();
    return p ? this.library.playlistSongs(p) : [];
  });

  constructor(
    route: ActivatedRoute,
    private router: Router,
    public library: LibraryService,
    public player: PlayerService
  ) {
    this.id = route.snapshot.paramMap.get('id') ?? '';
  }

  playAll(): void {
    const list = this.songs();
    if (list.length) this.player.play(list[0], list);
  }

  async deletePlaylist(): Promise<void> {
    await this.library.deletePlaylist(this.id);
    this.router.navigate(['/library']);
  }

  back(): void {
    history.back();
  }
}
