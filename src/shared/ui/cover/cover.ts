import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-cover',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cover.html',
  styleUrl: './cover.scss',
})
export class Cover {
  @Input() name = '';
  @Input() color = '#ff9000';
  @Input() imageUrl: string | null = null;

  imageFailed = false;

  get initial(): string {
    return this.name.trim().charAt(0).toUpperCase() || '♪';
  }
}
