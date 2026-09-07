import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UpdateService } from '../../services/update.service';

// Floating "a new version is here" prompt. One button finishes the job on both
// platforms; the details (and a manual check) live in the library page.
@Component({
  selector: 'app-update-banner',
  standalone: true,
  imports: [CommonModule],
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
    if (this.update.status() === 'downloading') return 'Downloading the update…';
    return version ? `Music Hub ${version} is available.` : 'A new version is ready.';
  });

  // Nothing may cancel a download half way — the button is the only control
  // while it runs.
  canDismiss = computed(() => this.update.status() !== 'downloading');

  constructor(public update: UpdateService) {}

  dismiss(): void {
    this.dismissed.set(true);
  }
}
