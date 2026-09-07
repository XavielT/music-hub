import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LibraryService } from '../../services/library.service';
import { ToastService } from '../../services/toast.service';

// Offers to look up cover art for the songs whose files carried none. Opt-in
// rather than automatic for a whole library: it is a request per song to an
// outside service, and that is the user's call to make.
@Component({
  selector: 'app-artwork-backfill',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './artwork-backfill.html',
  styleUrl: './artwork-backfill.scss',
})
export class ArtworkBackfill {
  missing = computed(() => this.library.missingArtwork().length);
  running = computed(() => this.library.artworkProgress() !== null);
  visible = computed(() => this.missing() > 0 || this.running());

  label = computed(() => {
    const progress = this.library.artworkProgress();
    if (progress) return `Looking up artwork — ${progress.done + 1} of ${progress.total}`;
    const count = this.missing();
    return `${count} song${count === 1 ? '' : 's'} without artwork`;
  });

  constructor(public library: LibraryService, private toast: ToastService) {}

  async run(): Promise<void> {
    const total = this.missing();
    const found = await this.library.findMissingArtwork();
    this.toast.show(
      found === 0
        ? `No artwork found for ${total === 1 ? 'that song' : 'those songs'}.`
        : `Found artwork for ${found} of ${total} song${total === 1 ? '' : 's'}.`
    );
  }
}
