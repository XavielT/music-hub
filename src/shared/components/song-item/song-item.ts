import { Component, EventEmitter, Input, Output, computed, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Cover } from '../../ui/cover/cover';
import { LibraryService } from '../../services/library.service';
import { SongModel } from '../../models/song.model';

@Component({
  selector: 'app-song-item',
  standalone: true,
  imports: [CommonModule, Cover],
  templateUrl: './song-item.html',
  styleUrl: './song-item.scss',
})
export class SongItem {
  song = input.required<SongModel>();

  // The queue actions live behind a toggle: three permanent buttons per row
  // would crowd a phone list, and these are occasional actions.
  menuOpen = signal(false);

  // Off on the playlist page, which has no picker to send the song to.
  canAddToPlaylist = input(true);

  // Members cannot push to the shared library, so their local-only songs
  // show as "stays on this device" rather than a tappable upload prompt.
  canUpload = input(true);
  @Input() active = false;
  @Input() removable = true;
  @Output() play = new EventEmitter<void>();
  @Output() addToPlaylist = new EventEmitter<void>();
  @Output() addToQueue = new EventEmitter<void>();
  @Output() playNext = new EventEmitter<void>();
  @Output() edit = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();
  @Output() upload = new EventEmitter<void>();
  @Output() download = new EventEmitter<void>();
  @Output() removeDownload = new EventEmitter<void>();

  constructor(public library: LibraryService) {}

  // One glyph summarising where the audio lives.
  //   ↑  only on this device, can be uploaded
  //   ⬇  in the cloud, not downloaded here
  //   ●  in the cloud and available offline
  badge = computed(() => {
    const song = this.song();
    if (song.syncState === 'uploading') return { icon: '⋯', title: 'Uploading…', kind: 'busy' };
    if (song.syncState === 'downloading') return { icon: '⋯', title: 'Downloading…', kind: 'busy' };
    if (song.syncState === 'local-only')
      return this.canUpload()
        ? { icon: '↑', title: 'On this device only — tap to upload', kind: 'local' }
        : { icon: '↑', title: 'On this device only', kind: 'local' };
    if (song.downloaded) return { icon: '●', title: 'In the cloud, available offline', kind: 'offline' };
    // A song added from a URL has no stored audio, so it can only stream.
    if (!song.storagePath) return { icon: '☁', title: 'Streams from a link — needs a connection', kind: 'cloud' };
    return { icon: '⬇', title: 'In the cloud — tap to download for offline', kind: 'cloud' };
  });

  // Cloud song with no local copy: unplayable without a connection.
  needsConnection = computed(() => {
    const song = this.song();
    return !song.downloaded && song.syncState === 'synced';
  });

  onBadgeClick(): void {
    const song = this.song();
    if (song.syncState === 'local-only') {
      if (this.canUpload()) this.upload.emit();
    }
    else if (song.syncState === 'synced' && !song.downloaded && song.storagePath) this.download.emit();
    else if (song.syncState === 'synced' && song.downloaded) this.removeDownload.emit();
  }

  formatDuration(seconds: number): string {
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
