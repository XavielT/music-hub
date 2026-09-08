import { Routes } from '@angular/router';
import { authGuard, guestGuard } from '../shared/guards/auth.guard';

export const routes: Routes = [
  // Landing page for the password-recovery link. No guard: the link itself
  // signs the user in, so it has to be reachable in both states — and it is
  // declared before 'auth' so the longer path matches first.
  {
    path: 'auth/reset',
    loadComponent: () => import('./pages/auth-reset/auth-reset').then(m => m.AuthResetComponent),
  },
  {
    path: 'auth',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/auth/auth').then(m => m.AuthComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/home/home').then(m => m.HomeComponent),
  },
  {
    path: 'search',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/search/search').then(m => m.SearchComponent),
  },
  {
    path: 'library',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/library/library').then(m => m.LibraryComponent),
  },
  {
    path: 'playlist/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/playlist-details/playlist-details').then(m => m.PlaylistDetailsComponent),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/settings/settings').then(m => m.SettingsComponent),
  },
  {
    path: 'storage',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/storage/storage').then(m => m.StorageComponent),
  },
  {
    path: 'add',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/add-music/add-music').then(m => m.AddMusicComponent),
  },
  { path: '**', redirectTo: '' },
];
