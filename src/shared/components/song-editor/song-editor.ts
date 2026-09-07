import { Component, EventEmitter, OnDestroy, OnInit, Output, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LibraryService } from '../../services/library.service';
import { shrinkCover } from '../../services/tags';
import { SongModel } from '../../models/song.model';

// Corrects what a file got wrong about itself. Same sheet-from-the-bottom
// shape as the playlist picker, so it reads as part of the app rather than a
// dialog bolted on.
@Component({
  selector: 'app-song-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './song-editor.html',
  styleUrl: './song-editor.scss',
})
export class SongEditor implements OnInit, OnDestroy {
  song = input.required<SongModel>();

  @Output() closed = new EventEmitter<void>();

  title = '';
  artist = '';
  album = '';

  saving = signal(false);
  // A replacement cover, already scaled down, waiting to be saved.
  private cover: Blob | null = null;
  coverPreview = signal<string | null>(null);

  constructor(public library: LibraryService) {}

  // Signal inputs are set before ngOnInit, and the dialog is created fresh
  // each time it opens, so this is the right moment to seed the fields.
  ngOnInit(): void {
    const song = this.song();
    this.title = song.title;
    this.artist = song.artist;
    this.album = song.album;
  }

  currentCover(): string | null {
    return this.coverPreview() ?? this.library.coverSrc(this.song());
  }

  async onCover(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // Scaled the same way tag artwork is, so a 4 MB photo does not go up.
    this.cover = await shrinkCover(file);
    this.releasePreview();
    this.coverPreview.set(URL.createObjectURL(this.cover));
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    await this.library.updateSongInfo(this.song().id, {
      title: this.title,
      artist: this.artist,
      album: this.album,
      cover: this.cover ?? undefined,
    });
    this.saving.set(false);
    this.closed.emit();
  }

  private releasePreview(): void {
    const url = this.coverPreview();
    if (url) URL.revokeObjectURL(url);
    this.coverPreview.set(null);
  }

  ngOnDestroy(): void {
    this.releasePreview();
  }
}
