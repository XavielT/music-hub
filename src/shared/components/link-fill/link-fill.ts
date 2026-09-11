import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LinkMetadataService, LinkResult, LinkTrack } from '../../services/link-metadata.service';
import { TPipe } from '../../i18n/t.pipe';

/** What the parent gets when the user accepts a lookup. */
export interface LinkFilled {
  track: LinkTrack;
  cover: Blob | null;
}

/**
 * Paste a link, see what came back, decide whether to use it.
 *
 * The preview step is the point. Everything a link gives back is somebody
 * else's data — a Spotify track is reliable, a YouTube title is a guess pulled
 * out of whatever the uploader typed — so nothing is written into the fields
 * until the user has looked at it and said yes.
 *
 * Shared by the edit dialog and the add-music page rather than written twice;
 * they differ only in what they do with the result.
 */
@Component({
  selector: 'app-link-fill',
  standalone: true,
  imports: [CommonModule, FormsModule, TPipe],
  templateUrl: './link-fill.html',
  styleUrl: './link-fill.scss',
})
export class LinkFill {
  /** Show the "add every track to the wanted list" action for album links. */
  @Input() offerWholeList = false;

  @Output() filled = new EventEmitter<LinkFilled>();
  /** An album or playlist link, when the parent offers to take all of it. */
  @Output() wantedAll = new EventEmitter<{ tracks: LinkTrack[]; url: string }>();

  url = '';
  result = signal<LinkResult | null>(null);
  applying = signal(false);

  constructor(public links: LinkMetadataService) {}

  first(): LinkTrack | null {
    return this.result()?.tracks[0] ?? null;
  }

  async look(): Promise<void> {
    this.result.set(null);
    const found = await this.links.lookup(this.url);
    if (found) this.result.set(found);
  }

  /** Fetches the cover too, so the parent gets everything in one go. */
  async apply(): Promise<void> {
    const track = this.first();
    if (!track || this.applying()) return;
    this.applying.set(true);
    const cover = await this.links.cover(track.coverUrl);
    this.applying.set(false);
    this.filled.emit({ track, cover });
    this.reset();
  }

  addAll(): void {
    const found = this.result();
    if (!found) return;
    this.wantedAll.emit({ tracks: found.tracks, url: this.url.trim() });
    this.reset();
  }

  reset(): void {
    this.url = '';
    this.result.set(null);
    this.links.clearError();
  }
}
