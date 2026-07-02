import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LibraryService } from '../../../shared/services/library.service';
import { YoutubeService, YoutubeResult } from '../../../shared/services/youtube.service';

interface PendingSong {
  file: File;
  title: string;
  artist: string;
  album: string;
}

@Component({
  selector: 'app-add-music',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './add-music.html',
  styleUrl: './add-music.scss',
})
export class AddMusicComponent {
  pending = signal<PendingSong[]>([]);
  saving = signal(false);
  savedMessage = signal('');

  // YouTube search / download
  ytQuery = '';
  ytResults = signal<YoutubeResult[]>([]);
  ytSearching = signal(false);
  ytDownloading = signal<string | null>(null);
  ytError = signal('');

  remoteUrl = '';
  remoteTitle = '';
  remoteArtist = '';

  constructor(private library: LibraryService, private youtube: YoutubeService) {}

  async ytSearch(): Promise<void> {
    const query = this.ytQuery.trim();
    if (!query || this.ytSearching()) return;
    this.ytError.set('');
    this.ytSearching.set(true);
    try {
      const videoId = this.youtube.parseVideoId(query);
      if (videoId) this.ytResults.set([await this.youtube.getResult(videoId)]);
      else this.ytResults.set(await this.youtube.search(query));
      if (this.ytResults().length === 0) this.ytError.set('No results found.');
    } catch {
      this.ytError.set('YouTube search failed. Note: this only works in the installed app, not in the browser preview.');
    }
    this.ytSearching.set(false);
  }

  async ytDownload(result: YoutubeResult): Promise<void> {
    if (this.ytDownloading()) return;
    this.ytError.set('');
    this.ytDownloading.set(result.id);
    try {
      const file = await this.youtube.downloadAudio(result.id);
      await this.library.addLocalSong(file, {
        title: result.title,
        artist: result.author,
        album: 'YouTube',
        coverUrl: result.thumbnail,
        duration: result.duration,
      });
      this.savedMessage.set(`"${result.title}" added to your library ✔`);
    } catch {
      this.ytError.set('Download failed. Try again in a moment.');
    }
    this.ytDownloading.set(null);
  }

  formatDuration(seconds: number): string {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const parsed = files.map(file => {
      // Try to parse "Artist - Title.mp3" from the file name
      const base = file.name.replace(/\.[^.]+$/, '');
      const parts = base.split(' - ');
      return {
        file,
        title: parts.length > 1 ? parts.slice(1).join(' - ').trim() : base,
        artist: parts.length > 1 ? parts[0].trim() : '',
        album: '',
      };
    });
    this.pending.update(list => [...list, ...parsed]);
    input.value = '';
  }

  removePending(index: number): void {
    this.pending.update(list => list.filter((_, i) => i !== index));
  }

  async saveAll(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    const items = this.pending();
    for (const item of items) {
      await this.library.addLocalSong(item.file, {
        title: item.title,
        artist: item.artist,
        album: item.album,
      });
    }
    this.pending.set([]);
    this.saving.set(false);
    this.savedMessage.set(`${items.length} song${items.length === 1 ? '' : 's'} added to your library ✔`);
  }

  async addRemote(): Promise<void> {
    const url = this.remoteUrl.trim();
    if (!url) return;
    await this.library.addRemoteSong(url, {
      title: this.remoteTitle.trim(),
      artist: this.remoteArtist.trim(),
      album: '',
    });
    this.remoteUrl = this.remoteTitle = this.remoteArtist = '';
    this.savedMessage.set('Song added from URL ✔');
  }
}
