import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../shared/services/auth.service';
import { LibraryService, SongGroup } from '../../../shared/services/library.service';
import { PlayerService } from '../../../shared/services/player.service';
import { SyncService } from '../../../shared/services/sync.service';
import { CloudLibraryService, STORAGE_QUOTA_BYTES } from '../../../shared/services/cloud-library.service';
import { SongItem } from '../../../shared/components/song-item/song-item';
import { PlaylistPicker } from '../../../shared/components/playlist-picker/playlist-picker';
import { Cover } from '../../../shared/ui/cover/cover';
import { InstallHint } from '../../../shared/components/install-hint/install-hint';
import { UpdatePanel } from '../../../shared/components/update-panel/update-panel';
import { ArtworkBackfill } from '../../../shared/components/artwork-backfill/artwork-backfill';
import { SongModel } from '../../../shared/models/song.model';

type LibraryTab = 'songs' | 'artists' | 'albums' | 'playlists';

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    SongItem,
    PlaylistPicker,
    Cover,
    InstallHint,
    UpdatePanel,
    ArtworkBackfill,
  ],
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

  accountInitial = computed(() => (this.auth.displayName().trim()[0] || '?').toUpperCase());

  // Storage quota bar (Supabase free tier gives 1 GB).
  usedLabel = computed(() => this.formatBytes(this.cloud.usedBytes()));
  quotaLabel = this.formatBytes(STORAGE_QUOTA_BYTES);
  usedPercent = computed(() => Math.round(this.cloud.usedFraction() * 100));
  nearQuota = computed(() => this.cloud.usedFraction() > 0.85);

  pendingUploads = computed(() => this.library.localOnlySongs().filter(s => s.downloaded).length);

  constructor(
    public library: LibraryService,
    public player: PlayerService,
    public auth: AuthService,
    public sync: SyncService,
    public cloud: CloudLibraryService,
    private router: Router
  ) {}

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/auth');
  }

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
