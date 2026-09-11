import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WantedService } from '../../services/wanted.service';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';
import { LinkFill, LinkFilled } from '../link-fill/link-fill';
import { LinkTrack } from '../../services/link-metadata.service';
import { TPipe } from '../../i18n/t.pipe';

/**
 * The wanted list: paste a link, and the title, artist and cover arrive.
 *
 * The empty state does the explaining, because this is the one screen where
 * somebody could reasonably expect pasting a Spotify link to produce a song.
 * It says plainly that the audio has to come from their own files.
 */
@Component({
  selector: 'app-wanted-panel',
  standalone: true,
  imports: [CommonModule, LinkFill, TPipe],
  templateUrl: './wanted-panel.html',
  styleUrl: './wanted-panel.scss',
})
export class WantedPanel {
  // Covers come straight from the provider's CDN here: this is a list, not the
  // library, so there is no offline story to keep and nothing to store.
  confirming = signal<string | null>(null);

  constructor(
    public wanted: WantedService,
    private toast: ToastService,
    private i18n: I18nService
  ) {}

  /** A single track link: one row. */
  async onFilled({ track }: LinkFilled): Promise<void> {
    await this.addTracks([track], '');
  }

  /** An album or playlist link: the whole thing, in one action. */
  async onAll({ tracks, url }: { tracks: LinkTrack[]; url: string }): Promise<void> {
    await this.addTracks(tracks, url);
  }

  private async addTracks(tracks: LinkTrack[], url: string): Promise<void> {
    const ok = await this.wanted.add(tracks, url);
    if (ok) this.toast.show(this.i18n.t('wanted.added', { count: tracks.length }));
    else this.toast.error(this.wanted.error() || this.i18n.t('err.noConnectionMoment'));
  }

  // Removing is one tap from a list of things somebody typed, so it asks once.
  async remove(id: string): Promise<void> {
    if (this.confirming() !== id) {
      this.confirming.set(id);
      return;
    }
    this.confirming.set(null);
    await this.wanted.remove(id);
  }
}
