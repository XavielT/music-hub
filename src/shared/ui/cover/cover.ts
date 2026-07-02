import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-cover',
  standalone: true,
  templateUrl: './cover.html',
  styleUrl: './cover.scss',
})
export class Cover {
  @Input() name = '';
  @Input() color = '#ff9000';

  get initial(): string {
    return this.name.trim().charAt(0).toUpperCase() || '♪';
  }
}
