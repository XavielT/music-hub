import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-stack">
      <div
        class="toast"
        *ngFor="let t of toasts.toasts()"
        [class.error]="t.kind === 'error'"
        (click)="toasts.dismiss(t.id)"
      >
        {{ t.text }}
      </div>
    </div>
  `,
  styleUrl: './toast.scss',
})
export class ToastHost {
  constructor(public toasts: ToastService) {}
}
