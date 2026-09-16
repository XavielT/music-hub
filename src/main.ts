import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { installErrorHooks, milestone, record, rotate } from './boot/boot-log';
import {
  clearLocalState,
  debugEnabled,
  disableServiceWorkers,
  reloadWithoutFlags,
  resetRequested,
  safeMode,
} from './boot/flags';
import { showDebugOverlay } from './boot/overlay';
import { bootSettled, startWatchdog } from './boot/watchdog';

// Everything before bootstrapApplication() is here rather than in index.html
// because the CSP allows no inline script — and because this is the code that
// has to keep working when the app itself does not.

rotate();
installErrorHooks();
milestone('main start');

// The browser has clearly got this far, so whatever index.html is showing for
// browsers that could not parse this bundle has done its job and should go.
document.getElementById('unsupported-browser')?.remove();

void boot();

async function boot(): Promise<void> {
  if (safeMode()) {
    milestone('safe mode: dropping service workers');
    await disableServiceWorkers();
    if (resetRequested()) {
      milestone('reset: clearing local state');
      clearLocalState();
      // Straight back to a clean URL, or a refresh would clear it all again.
      reloadWithoutFlags();
      return;
    }
    showSafeModeBanner();
  }

  startWatchdog();

  try {
    await bootstrapApplication(App, appConfig);
    milestone('bootstrap resolved');
  } catch (err) {
    record('error', `bootstrap failed: ${(err as Error)?.message ?? err}`);
    console.error(err);
  } finally {
    bootSettled();
    if (debugEnabled()) showDebugOverlay();
  }
}

// Safe mode is a diagnostic, and an app that had quietly stopped being a PWA
// would be a worse bug than the one being chased — so it says so on screen.
function showSafeModeBanner(): void {
  const spanish = navigator.language?.toLowerCase().startsWith('es') ?? false;
  const banner = document.createElement('div');
  banner.className = 'safe-mode-banner';
  banner.textContent = spanish
    ? 'Modo seguro — sin service worker'
    : 'Safe mode — service worker disabled';

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', spanish ? 'Cerrar' : 'Dismiss');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => banner.remove());
  banner.appendChild(dismiss);

  document.body.appendChild(banner);
}
