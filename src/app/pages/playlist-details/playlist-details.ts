import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../shared/services/auth.service';
import { LibraryService } from '../../../shared/services/library.service';
import { PlayerService } from '../../../shared/services/player.service';
import { SyncService } from '../../../shared/services/sync.service';
import { SongItem } from '../../../shared/components/song-item/song-item';
import { SongEditor } from '../../../shared/components/song-editor/song-editor';
import { Cover } from '../../../shared/ui/cover/cover';
import { SongModel } from '../../../shared/models/song.model';

@Component({
  selector: 'app-playlist-details',
  standalone: true,
  imports: [CommonModule, SongItem, SongEditor, Cover],
  templateUrl: './playlist-details.html',
  styleUrl: './playlist-details.scss',
})
export class PlaylistDetailsComponent {
  editing = signal<SongModel | null>(null);
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
    public player: PlayerService,
    public sync: SyncService,
    public auth: AuthService
  ) {
    this.id = route.snapshot.paramMap.get('id') ?? '';
  }

  // Pull every cloud song in this playlist down for offline listening.
  downloadAll(): void {
    void this.sync.downloadPlaylist(this.songs());
  }

  offlineCount = computed(() => this.songs().filter(s => s.downloaded).length);

  playAll(): void {
    const list = this.songs();
    if (list.length) this.player.play(list[0], list);
  }

  shuffleAll(): void {
    void this.player.shufflePlay(this.songs());
  }

  // Opens the playlist to the household, or closes it again.
  toggleShared(): void {
    const p = this.playlist();
    if (p) void this.library.setPlaylistShared(p.id, !p.isShared);
  }

  async deletePlaylist(): Promise<void> {
    await this.library.deletePlaylist(this.id);
    this.router.navigate(['/library']);
  }

  back(): void {
    history.back();
  }
}
