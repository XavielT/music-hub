import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LibraryService } from '../../services/library.service';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../i18n/t.pipe';

// Offers to look up cover art for the songs whose files carried none. Opt-in
// rather than automatic for a whole library: it is a request per song to an
// outside service, and that is the user's call to make.
@Component({
  selector: 'app-artwork-backfill',
  standalone: true,
  imports: [CommonModule, TPipe],
  templateUrl: './artwork-backfill.html',
  styleUrl: './artwork-backfill.scss',
})
export class ArtworkBackfill {
  missing = computed(() => this.library.missingArtwork().length);
  running = computed(() => this.library.artworkProgress() !== null);
  visible = computed(() => this.missing() > 0 || this.running());

  label = computed(() => {
    const progress = this.library.artworkProgress();
    if (progress)
      return this.i18n.t('artwork.lookingUp', { done: progress.done + 1, total: progress.total });
    return this.i18n.t('artwork.withoutArtwork', { count: this.missing() });
  });

  constructor(
    public library: LibraryService,
    private toast: ToastService,
    private i18n: I18nService
  ) {}

  async run(): Promise<void> {
    const total = this.missing();
    const found = await this.library.findMissingArtwork();
    this.toast.show(
      found === 0
        ? this.i18n.t(total === 1 ? 'artwork.noneFound' : 'artwork.noneFoundMany')
        : this.i18n.t('artwork.foundFor', { found, total })
    );
  }
}
