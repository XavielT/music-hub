import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

const TOAST_MS = 4000;

// Short-lived messages for things that happen away from a button press:
// failed syncs, finished uploads, playback that needs a connection.
@Injectable({ providedIn: 'root' })
export class ToastService {
  private _toasts = signal<Toast[]>([]);
  toasts = this._toasts.asReadonly();
  private nextId = 1;

  show(text: string, kind: 'info' | 'error' = 'info'): void {
    const id = this.nextId++;
    this._toasts.update(list => [...list, { id, text, kind }]);
    setTimeout(() => this.dismiss(id), TOAST_MS);
  }

  error(text: string): void {
    this.show(text, 'error');
  }

  dismiss(id: number): void {
    this._toasts.update(list => list.filter(t => t.id !== id));
  }
}
