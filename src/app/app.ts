import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { PlayerBar } from './components/player-bar/player-bar';
import { BottomNav } from './components/bottom-nav/bottom-nav';
import { AuthService } from '../shared/services/auth.service';
import { SyncService } from '../shared/services/sync.service';
import { ToastHost } from '../shared/ui/toast/toast';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, PlayerBar, BottomNav, ToastHost],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  // SyncService is injected so it starts watching the session right away:
  // it pulls the cloud library as soon as a user is available.
  constructor(public auth: AuthService, private sync: SyncService) {}
}
