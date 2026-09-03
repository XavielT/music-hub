import { Routes } from '@angular/router';
import { authGuard, guestGuard } from '../shared/guards/auth.guard';

export const routes: Routes = [
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
    path: 'add',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/add-music/add-music').then(m => m.AddMusicComponent),
  },
  { path: '**', redirectTo: '' },
];
