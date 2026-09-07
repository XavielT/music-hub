import { Component, computed, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { AuthService } from '../../../shared/services/auth.service';
import { LibraryService } from '../../../shared/services/library.service';
import { SyncService } from '../../../shared/services/sync.service';
import { ToastService } from '../../../shared/services/toast.service';
import { UpdateService } from '../../../shared/services/update.service';
import { ThemeService } from '../../../shared/services/theme.service';
import {
  CloudLibraryService,
  STORAGE_QUOTA_BYTES,
} from '../../../shared/services/cloud-library.service';
import { UpdatePanel } from '../../../shared/components/update-panel/update-panel';
import { ArtworkBackfill } from '../../../shared/components/artwork-backfill/artwork-backfill';
import { InstallHint } from '../../../shared/components/install-hint/install-hint';

// Everything about the app and the account, so the library can be about music.
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, UpdatePanel, ArtworkBackfill, InstallHint],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class SettingsComponent implements OnInit {
  readonly isNative = Capacitor.isNativePlatform();

  accountInitial = computed(() => (this.auth.displayName().trim()[0] || '?').toUpperCase());

  usedLabel = computed(() => this.formatBytes(this.cloud.usedBytes()));
  quotaLabel = this.formatBytes(STORAGE_QUOTA_BYTES);
  usedPercent = computed(() => Math.round(this.cloud.usedFraction() * 100));
  nearQuota = computed(() => this.cloud.usedFraction() > 0.85);

  pendingUploads = computed(() => this.library.localOnlySongs().filter(s => s.downloaded).length);

  downloadedCount = computed(() => this.library.songs().filter(s => s.downloaded).length);

  clearableBytes = computed(() =>
    this.library.clearableDownloads().reduce((total, s) => total + s.sizeBytes, 0)
  );

  sendingReset = signal(false);
  // Clearing is reversible but not free — it costs a re-download — so the
  // button asks once rather than firing on the first tap.
  confirmingClear = signal(false);
  clearing = signal(false);

  constructor(
    public auth: AuthService,
    public library: LibraryService,
    public sync: SyncService,
    public cloud: CloudLibraryService,
    public update: UpdateService,
    public theme: ThemeService,
    private toast: ToastService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Android can revoke the install permission while the app is not running,
    // so this is read fresh every time rather than trusted from startup.
    void this.update.refreshInstallPermission();
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/auth');
  }

  // Password changes go through the same emailed link as "forgot password",
  // so there is no new-password form to get wrong here.
  async sendPasswordReset(): Promise<void> {
    const email = this.auth.user()?.email;
    if (!email || this.sendingReset()) return;
    this.sendingReset.set(true);
    const result = await this.auth.sendPasswordReset(email);
    this.sendingReset.set(false);
    if (result.ok) this.toast.show(result.message ?? `Reset link sent to ${email}.`);
    else this.toast.error(result.message ?? 'Could not send the reset email.');
  }

  onCustomAccent(event: Event): void {
    this.theme.set((event.target as HTMLInputElement).value);
  }

  async clearDownloads(): Promise<void> {
    if (!this.confirmingClear()) {
      this.confirmingClear.set(true);
      // Untouched after a few seconds, it goes back to being a safe button.
      setTimeout(() => this.confirmingClear.set(false), 5000);
      return;
    }
    this.confirmingClear.set(false);
    this.clearing.set(true);
    const { cleared, freedBytes } = await this.library.clearDownloads();
    this.clearing.set(false);
    this.toast.show(
      cleared === 0
        ? 'Nothing to clear.'
        : `Cleared ${cleared} download${cleared === 1 ? '' : 's'} — ${this.formatBytes(freedBytes)} freed. They stream until you download them again.`
    );
  }

  async allowInstalls(): Promise<void> {
    const granted = await this.update.requestInstallPermission();
    this.toast.show(
      granted
        ? 'Music Hub can install its own updates now.'
        : 'Still off — updates will have to be installed by hand.'
    );
  }

  back(): void {
    history.back();
  }
}
