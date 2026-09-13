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

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // Restore the Supabase session before the first navigation so the route
    // guards already know whether the user is signed in (no /auth flicker).
    provideAppInitializer(() => inject(AuthService).init()),
    // Paint the chosen accent before anything renders. Constructing the
    // service is what applies it, and without this nothing constructs it until
    // the settings page is opened — so the app would start in the default
    // colour every launch and only correct itself once you went looking.
    provideAppInitializer(() => {
      inject(ThemeService);
    }),
    // Same reasoning for the language: constructing the service is what reads
    // the device's choice and sets <html lang>. Without this the first paint —
    // the auth screen, most often — would be in English until something else
    // happened to inject it.
    //
    // The returned promise is the other half: dictionaries are lazy chunks now,
    // and awaiting init() here is what guarantees the words have arrived before
    // anything renders. Drop the `return` and the first paint is raw keys.
    provideAppInitializer(() => inject(I18nService).init()),
    // Service worker for the installable web app only. Inside the Capacitor
    // WebView the native shell already serves the assets locally, and a second
    // cache layer there would fight it.
    provideServiceWorker('ngsw-worker.js', {
      enabled: environment.production && !Capacitor.isNativePlatform(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
