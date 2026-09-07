import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { PlayerBar } from './components/player-bar/player-bar';
import { BottomNav } from './components/bottom-nav/bottom-nav';
import { AuthService } from '../shared/services/auth.service';
import { SyncService } from '../shared/services/sync.service';
import { PwaService } from '../shared/services/pwa.service';
import { ToastHost } from '../shared/ui/toast/toast';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, PlayerBar, BottomNav, ToastHost],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private url = signal('/');

  // The auth pages are full-screen cards. /auth/reset is reached with a live
  // session (the recovery link signs the user in), so signedIn() alone would
  // drop the player bar and nav on top of its form.
  showChrome = computed(() => this.auth.signedIn() && !this.url().startsWith('/auth'));

  // SyncService is injected so it starts watching the session right away:
  // it pulls the cloud library as soon as a user is available.
  constructor(
    public auth: AuthService,
    private sync: SyncService,
    public pwa: PwaService,
    router: Router
  ) {
    this.url.set(router.url);
    router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => this.url.set(e.urlAfterRedirects));
  }
}
