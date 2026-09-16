import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { Capacitor } from '@capacitor/core';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { AuthService } from '../shared/services/auth.service';
import { ThemeService } from '../shared/services/theme.service';
import { I18nService } from '../shared/services/i18n.service';
import { milestone, record } from '../boot/boot-log';
import { safeMode } from '../boot/flags';

// How long any one initializer may hold the app closed. Every one of them is
// preparation — a session, an accent colour, a dictionary — and none is worth
// a blank screen. Past this the app opens in whatever state it reached.
const INITIALIZER_TIMEOUT_MS = 5000;

/**
 * Runs an initializer that can fail without taking the app with it.
 *
 * Both halves have been the cause of a white screen in this project before. A
 * rejection leaves Angular un-bootstrapped, so a dictionary chunk that 404s
 * after a deploy would stop the app opening at all; and an initializer that
 * simply never settles — getSession() against an unreachable Supabase, a
 * dynamic import on a dead connection — hangs bootstrap with no error to show
 * for it. Neither is a reason not to open the app.
 */
function failSoft(name: string, run: () => unknown): Promise<void> {
  // run() is called synchronously and deliberately: it is what calls inject(),
  // and an injection context does not survive a microtask. Deferring this with
  // Promise.resolve().then(run) costs an NG0203 at startup.
  let started: Promise<unknown>;
  try {
    started = Promise.resolve(run());
  } catch (err) {
    record('error', `init ${name} threw: ${(err as Error)?.message ?? err}`);
    return Promise.resolve();
  }

  const settled = started.then(
    () => milestone(`init ${name}`),
    err => record('error', `init ${name} failed: ${(err as Error)?.message ?? err}`)
  );

  const deadline = new Promise<void>(resolve =>
    setTimeout(() => {
      record('warn', `init ${name} timed out after ${INITIALIZER_TIMEOUT_MS}ms`);
      resolve();
    }, INITIALIZER_TIMEOUT_MS)
  );

  return Promise.race([settled, deadline]);
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // Restore the Supabase session before the first navigation so the route
    // guards already know whether the user is signed in (no /auth flicker).
    provideAppInitializer(() => failSoft('auth', () => inject(AuthService).init())),
    // Paint the chosen accent before anything renders. Constructing the
    // service is what applies it, and without this nothing constructs it until
    // the settings page is opened — so the app would start in the default
    // colour every launch and only correct itself once you went looking.
    provideAppInitializer(() =>
      failSoft('theme', () => {
        inject(ThemeService);
      })
    ),
    // Same reasoning for the language: constructing the service is what reads
    // the device's choice and sets <html lang>. Without this the first paint —
    // the auth screen, most often — would be in English until something else
    // happened to inject it.
    //
    // The returned promise is the other half: dictionaries are lazy chunks now,
    // and awaiting init() here is what guarantees the words have arrived before
    // anything renders. Drop the `return` and the first paint is raw keys.
    provideAppInitializer(() => failSoft('i18n', () => inject(I18nService).init())),
    // Service worker for the installable web app only. Inside the Capacitor
    // WebView the native shell already serves the assets locally, and a second
    // cache layer there would fight it. ?safe=1 turns it off for one load, so a
    // cache that is serving a broken build can be ruled out from a phone.
    provideServiceWorker('ngsw-worker.js', {
      enabled: environment.production && !Capacitor.isNativePlatform() && !safeMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
