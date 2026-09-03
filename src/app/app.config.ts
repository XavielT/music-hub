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

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // Restore the Supabase session before the first navigation so the route
    // guards already know whether the user is signed in (no /auth flicker).
    provideAppInitializer(() => inject(AuthService).init()),
    // Service worker for the installable web app only. Inside the Capacitor
    // WebView the native shell already serves the assets locally, and a second
    // cache layer there would fight it.
    provideServiceWorker('ngsw-worker.js', {
      enabled: environment.production && !Capacitor.isNativePlatform(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
