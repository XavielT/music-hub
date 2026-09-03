import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { AuthService } from '../shared/services/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // Restore the Supabase session before the first navigation so the route
    // guards already know whether the user is signed in (no /auth flicker).
    provideAppInitializer(() => inject(AuthService).init()),
  ],
};
