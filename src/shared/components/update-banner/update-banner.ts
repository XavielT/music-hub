import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UpdateService } from '../../services/update.service';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../i18n/t.pipe';

// Floating "a new version is here" prompt. One button finishes the job on both
// platforms; the details (and a manual check) live in the library page.
@Component({
  selector: 'app-update-banner',
  standalone: true,
  imports: [CommonModule, TPipe],
  templateUrl: './update-banner.html',
  styleUrl: './update-banner.scss',
})
export class UpdateBanner {
  private dismissed = signal(false);

  visible = computed(() => {
    if (this.dismissed()) return false;
    const status = this.update.status();
    return status === 'available' || status === 'downloading' || status === 'ready';
  });

  message = computed(() => {
    const version = this.update.available()?.version;
    if (this.update.status() === 'downloading') return this.i18n.t('update.downloadingBanner');
    return version
      ? this.i18n.t('update.versionBanner', { version })
      : this.i18n.t('update.banner');
  });

  // Nothing may cancel a download half way — the button is the only control
  // while it runs.
  canDismiss = computed(() => this.update.status() !== 'downloading');

  constructor(
    public update: UpdateService,
    private i18n: I18nService
  ) {}

  dismiss(): void {
    this.dismissed.set(true);
  }
}
