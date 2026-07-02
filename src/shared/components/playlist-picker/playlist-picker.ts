import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LibraryService } from '../../services/library.service';

@Component({
  selector: 'app-playlist-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './playlist-picker.html',
  styleUrl: './playlist-picker.scss',
})
export class PlaylistPicker {
  @Output() picked = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  newName = '';

  constructor(public library: LibraryService) {}

  async create(): Promise<void> {
    const name = this.newName.trim();
    if (!name) return;
    const playlist = await this.library.createPlaylist(name);
    this.newName = '';
    this.picked.emit(playlist.id);
  }
}
