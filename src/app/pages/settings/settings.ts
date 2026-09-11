import { Component, computed, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { AuthService } from '../../../shared/services/auth.service';
import { LibraryService } from '../../../shared/services/library.service';
import { SyncService } from '../../../shared/services/sync.service';
import { RealtimeService } from '../../../shared/services/realtime.service';
import { ToastService } from '../../../shared/services/toast.service';
import { UpdateService } from '../../../shared/services/update.service';
import { ThemeService } from '../../../shared/services/theme.service';
import { I18nService, LANGUAGES, Lang } from '../../../shared/services/i18n.service';
import {
  CloudLibraryService,
  STORAGE_QUOTA_BYTES,
} from '../../../shared/services/cloud-library.service';
import { UpdatePanel } from '../../../shared/components/update-panel/update-panel';
import { ArtworkBackfill } from '../../../shared/components/artwork-backfill/artwork-backfill';
import { InstallHint } from '../../../shared/components/install-hint/install-hint';
import { InvitesPanel } from '../../../shared/components/invites-panel/invites-panel';
import { CompanionPanel } from '../../../shared/components/companion-panel/companion-panel';
import { TPipe } from '../../../shared/i18n/t.pipe';

// Everything about the app and the account, so the library can be about music.
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, UpdatePanel, ArtworkBackfill, InstallHint, InvitesPanel, CompanionPanel, TPipe],
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

  // What the live channel is doing, in the terms someone reading a settings
  // screen cares about: is this device being kept up to date or not.
  liveLabel = computed(() => {
    switch (this.realtime.status()) {
      case 'live':
        return this.i18n.t('settings.live.connected');
      case 'connecting':
        return this.i18n.t('settings.live.connecting');
      case 'error':
        return this.i18n.t('settings.live.offline');
      default:
        return '';
    }
  });

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
    public realtime: RealtimeService,
    public cloud: CloudLibraryService,
    public update: UpdateService,
    public theme: ThemeService,
    private toast: ToastService,
    private router: Router,
    public i18n: I18nService
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
    if (result.ok) this.toast.show(result.message ?? this.i18n.t('settings.resetSentTo', { email }));
    else this.toast.error(result.message ?? this.i18n.t('settings.resetFailed'));
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
        ? this.i18n.t('settings.nothingToClear')
        : this.i18n.t('settings.cleared', { count: cleared, size: this.formatBytes(freedBytes) })
    );
  }

  async allowInstalls(): Promise<void> {
    const granted = await this.update.requestInstallPermission();
    this.toast.show(
      granted
        ? this.i18n.t('settings.installsAllowed')
        : this.i18n.t('settings.installsStillOff')
    );
  }

  readonly languages = LANGUAGES;

  /**
   * Applies the language now and remembers it on the profile, so it follows the
   * user to their other devices. The local switch is not conditional on the
   * write succeeding: offline, the device copy is still the right answer.
   */
  async setLanguage(lang: Lang): Promise<void> {
    this.i18n.use(lang);
    await this.auth.saveLanguage(lang);
  }

  openAdmin(): void {
    void this.router.navigateByUrl('/admin');
  }

  openStorage(): void {
    void this.router.navigateByUrl('/storage');
  }

  back(): void {
    history.back();
  }
}
