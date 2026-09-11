import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Keeps everyone but admins out of /admin.
//
// This is a courtesy, not a control: the panel's data comes from a function
// that checks `is_admin()` itself and its actions go through an Edge Function
// that does the same. Someone who types the URL gets a page that can do
// nothing — the guard just spares them the empty screen.
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAdmin()) return true;
  return router.createUrlTree([auth.signedIn() ? '/' : '/auth']);
};
