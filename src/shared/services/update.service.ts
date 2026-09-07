import { Injectable, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { Capacitor } from '@capacitor/core';
import { filter } from 'rxjs/operators';
import { AppUpdate } from '../native/app-update.plugin';
import { ToastService } from './toast.service';
import { environment } from '../../environments/environment';
import { APP_VERSION } from '../../version';

//  idle        : nothing to do (or not checked yet)
//  checking    : looking for a newer version
//  available   : a newer version exists and has to be fetched (Android)
//  downloading : pulling the APK down
//  ready       : everything needed is on the device — one tap finishes it
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready';

export interface AvailableUpdate {
  version: string;
  notes: string;
  apkUrl?: string;
  sizeBytes?: number;
}

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GithubAsset[];
}

const APK_ASSET = 'music-hub.apk';

/**
 * Keeps the app up to date on both shapes it ships in.
 *
 * Web / installed PWA: Angular's service worker downloads a new build in the
 * background, so "update" is really "activate and reload".
 *
 * Android: the app is sideloaded from GitHub Releases, so there is no store to
 * do this. It asks the releases API whether a newer tag exists, downloads the
 * attached APK and opens the system installer with it.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  readonly isNative = Capacitor.isNativePlatform();

  private _status = signal<UpdateStatus>('idle');
  status = this._status.asReadonly();

  private _available = signal<AvailableUpdate | null>(null);
  available = this._available.asReadonly();

  // -1 while the size of the download is unknown.
  private _progress = signal(0);
  progress = this._progress.asReadonly();

  private _currentVersion = signal(APP_VERSION);
  currentVersion = this._currentVersion.asReadonly();

  private _error = signal<string | null>(null);
  error = this._error.asReadonly();

  // Android 8+ gates "install unknown apps" per app, and revokes it again for
  // apps it decides are unused — so an install that worked last month can stop
  // working with no warning. null means the question does not apply (web).
  private _canInstall = signal<boolean | null>(null);
  canInstall = this._canInstall.asReadonly();

  private downloadedPath: string | null = null;

  constructor(private updates: SwUpdate, private toast: ToastService) {
    if (this.isNative) {
      // The installed APK is the truth about what is running — a bundled
      // constant would be whatever the last web build said.
      void AppUpdate.getInfo()
        .then(info => this._currentVersion.set(info.versionName))
        .catch(() => undefined);
      void AppUpdate.addListener('downloadProgress', p => this._progress.set(p.percent));
      void this.refreshInstallPermission();
      // A check on launch is what makes this feel like a store app; failures
      // here are silent because nobody asked for it.
      void this.check(false);
      return;
    }

    if (this.updates.isEnabled) {
      this.updates.versionUpdates
        .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
        .subscribe(() => {
          this._available.set({ version: '', notes: '' });
          this._status.set('ready');
        });
    }
  }

  // Re-reads whether the app may install updates. Worth calling whenever the
  // settings screen is opened, since the answer changes outside the app.
  async refreshInstallPermission(): Promise<void> {
    if (!this.isNative) return;
    try {
      const { granted } = await AppUpdate.canInstall();
      this._canInstall.set(granted);
    } catch {
      this._canInstall.set(null);
    }
  }

  // Sends the user to the one system screen that can grant it, and reports
  // back what they chose.
  async requestInstallPermission(): Promise<boolean> {
    if (!this.isNative) return false;
    try {
      const { granted } = await AppUpdate.openInstallSettings();
      this._canInstall.set(granted);
      return granted;
    } catch {
      return false;
    }
  }

  /**
   * Looks for a newer version. `announce` is true when the user pressed the
   * button and therefore deserves an answer either way.
   */
  async check(announce = true): Promise<void> {
    if (this._status() === 'checking' || this._status() === 'downloading') return;
    // Already found and downloaded — nothing to look for.
    if (this._status() === 'ready') {
      if (announce) this.toast.show('The update is ready to install.');
      return;
    }

    this._error.set(null);
    this._status.set('checking');
    try {
      const found = this.isNative ? await this.checkGithub() : await this.checkServiceWorker();
      if (found) return;
      this._status.set('idle');
      if (announce) this.toast.show(`You are on the latest version (${this._currentVersion()}).`);
    } catch (e) {
      this._status.set('idle');
      const message = e instanceof Error ? e.message : 'Could not check for updates.';
      this._error.set(message);
      if (announce) this.toast.error(message);
    }
  }

  private async checkServiceWorker(): Promise<boolean> {
    if (!this.updates.isEnabled) return false;
    // Resolves true once a new build has been *downloaded*, so by the time we
    // get here the only thing left is the reload.
    const found = await this.updates.checkForUpdate();
    if (found) {
      this._available.set({ version: '', notes: '' });
      this._status.set('ready');
    }
    return found;
  }

  private async checkGithub(): Promise<boolean> {
    const response = await fetch(
      `https://api.github.com/repos/${environment.updateRepo}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' }
    );
    if (response.status === 403 || response.status === 429) {
      throw new Error('GitHub is rate-limiting the update check. Try again in a few minutes.');
    }
    if (!response.ok) throw new Error('Could not reach GitHub to check for updates.');

    const release = (await response.json()) as GithubRelease;
    const version = (release.tag_name ?? '').replace(/^v/i, '');
    if (!version || release.draft) return false;
    if (!isNewer(version, this._currentVersion())) return false;

    const apk = (release.assets ?? []).find(a => a.name === APK_ASSET);
    if (!apk) {
      throw new Error(`Release ${version} has no ${APK_ASSET} attached yet.`);
    }

    this._available.set({
      version,
      notes: (release.body ?? '').trim(),
      apkUrl: apk.browser_download_url,
      sizeBytes: apk.size,
    });
    this._status.set('available');
    return true;
  }

  /**
   * Finishes the update. On the web that is a reload; on Android it downloads
   * the APK if needed and opens the installer — the same button throughout, so
   * it is at most a download tap and Android's own "Install" tap.
   */
  async apply(): Promise<void> {
    this._error.set(null);
    if (!this.isNative) return this.reloadOntoNewBuild();

    const update = this._available();
    if (!update?.apkUrl) return;

    try {
      if (!(await this.ensureInstallPermission())) return;

      if (!this.downloadedPath) {
        this._status.set('downloading');
        this._progress.set(0);
        const { path } = await AppUpdate.download({ url: update.apkUrl });
        this.downloadedPath = path;
        this._status.set('ready');
      }

      await AppUpdate.install({ path: this.downloadedPath });
    } catch (e) {
      // Back to a state the button can retry from.
      this._status.set(this.downloadedPath ? 'ready' : 'available');
      const message = e instanceof Error ? e.message : 'The update could not be installed.';
      this._error.set(message);
      this.toast.error(message);
    }
  }

  // Android 8+ requires a one-time per-app opt-in before anything may open the
  // package installer. Ask for it at the moment it is needed, not on launch.
  private async ensureInstallPermission(): Promise<boolean> {
    const { granted } = await AppUpdate.canInstall();
    this._canInstall.set(granted);
    if (granted) return true;
    this.toast.show('Allow Music Hub to install apps, then press Update again.');
    const result = await AppUpdate.openInstallSettings();
    this._canInstall.set(result.granted);
    return result.granted;
  }

  private async reloadOntoNewBuild(): Promise<void> {
    try {
      await this.updates.activateUpdate();
    } catch {
      // Fall through to the reload: worst case the old version loads again.
    }
    document.location.reload();
  }

  // What the button says, so the banner and the library panel cannot drift.
  actionLabel(): string {
    switch (this._status()) {
      case 'downloading':
        return this._progress() >= 0 ? `${this._progress()}%` : 'Downloading…';
      case 'ready':
        return this.isNative ? 'Install' : 'Reload';
      default:
        return 'Update';
    }
  }

  formatSize(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

// Compares dotted versions numerically: "0.10.0" is newer than "0.9.9", which
// a string comparison gets wrong. Anything after a -suffix is ignored.
export function isNewer(remote: string, current: string): boolean {
  const parts = (v: string) =>
    v
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map(n => parseInt(n, 10) || 0);
  const a = parts(remote);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}
