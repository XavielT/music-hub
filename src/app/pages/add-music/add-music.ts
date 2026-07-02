import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LibraryService } from '../../../shared/services/library.service';

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

  remoteUrl = '';
  remoteTitle = '';
  remoteArtist = '';

  constructor(private library: LibraryService) {}

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
