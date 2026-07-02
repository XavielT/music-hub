import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PlayerBar } from './components/player-bar/player-bar';
import { BottomNav } from './components/bottom-nav/bottom-nav';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, PlayerBar, BottomNav],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
