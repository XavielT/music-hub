import { Injectable, effect, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { Capacitor } from '@capacitor/core';
import { filter } from 'rxjs/operators';
import { AuthService } from './auth.service';

// Chromium fires this before showing its own install prompt; capturing it
// lets the app offer an Install button at a moment of its choosing.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Injectable({ providedIn: 'root' })
export class PwaService {
  // A newer build is cached and will be used after a reload.
  private _updateReady = signal(false);
  updateReady = this._updateReady.asReadonly();

  // Chromium only: set once the browser says the app is installable.
  private _canPrompt = signal(false);
  canPrompt = this._canPrompt.asReadonly();

  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private persistenceAsked = false;

  constructor(private updates: SwUpdate, private auth: AuthService) {
    // Downloaded songs are the whole point of the offline mode, and on iOS a
    // PWA's IndexedDB can be evicted under storage pressure. Asking to be
    // persistent is one call and only makes sense with a library to protect,
    // so it waits for a signed-in user. Browsers only grant it to installed /
    // engaged sites; a refusal changes nothing.
    effect(() => {
      if (this.auth.user()) void this.requestPersistentStorage();
    });

    this.updates.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this._updateReady.set(true));

    window.addEventListener('beforeinstallprompt', event => {
      // Suppress the mini-infobar so the in-app button is the entry point.
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this._canPrompt.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this._canPrompt.set(false);
    });
  }

  private async requestPersistentStorage(): Promise<void> {
    // The native shell stores its data in the app sandbox — nothing to ask.
    if (this.persistenceAsked || Capacitor.isNativePlatform()) return;
    this.persistenceAsked = true;
    try {
      if (await navigator.storage?.persisted?.()) return;
      await navigator.storage?.persist?.();
    } catch {
      // Not supported (or blocked) on this browser.
    }
  }

  // True once the app runs from the home screen / app window rather than a tab.
  get isInstalled(): boolean {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari predates display-mode and uses a non-standard flag.
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
  }

  get isIos(): boolean {
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  async promptInstall(): Promise<void> {
    if (!this.deferredPrompt) return;
    await this.deferredPrompt.prompt();
    await this.deferredPrompt.userChoice;
    this.deferredPrompt = null;
    this._canPrompt.set(false);
  }

  // Activates the waiting worker and reloads onto the new build.
  async applyUpdate(): Promise<void> {
    try {
      await this.updates.activateUpdate();
    } catch {
      // Fall through to the reload: worst case the old version loads again.
    }
    document.location.reload();
  }
}
