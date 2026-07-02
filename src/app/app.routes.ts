import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home').then(m => m.HomeComponent) },
  { path: 'search', loadComponent: () => import('./pages/search/search').then(m => m.SearchComponent) },
  { path: 'library', loadComponent: () => import('./pages/library/library').then(m => m.LibraryComponent) },
  {
    path: 'playlist/:id',
    loadComponent: () => import('./pages/playlist-details/playlist-details').then(m => m.PlaylistDetailsComponent),
  },
  { path: 'add', loadComponent: () => import('./pages/add-music/add-music').then(m => m.AddMusicComponent) },
  { path: '**', redirectTo: '' },
];
