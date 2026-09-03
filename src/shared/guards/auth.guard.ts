import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Protects the app: signed-out visitors go to /auth.
// AuthService.init() already ran during app initialization, so the signal is
// settled here and the guard never flickers.
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.signedIn()) return true;
  return router.createUrlTree(['/auth'], { queryParams: { redirect: state.url } });
};

// Keeps signed-in users out of /auth.
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.signedIn()) return true;
  return router.createUrlTree(['/']);
};
