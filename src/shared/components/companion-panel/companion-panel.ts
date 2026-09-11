import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { CompanionService } from '../../services/companion.service';
import { CompanionWorkerService } from '../../services/companion-worker.service';
import { ToastService } from '../../services/toast.service';

// Where the yt-dlp companion lives. Admin-only, because only admins add to the
// shared library — and because the token is a credential for a service that
// downloads on your behalf.
@Component({
  selector: 'app-companion-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './companion-panel.html',
  styleUrl: './companion-panel.scss',
})
export class CompanionPanel implements OnInit {
  url: string;
  token: string;
  // The token is write-only in practice: shown masked, replaced when retyped.
  revealed = signal(false);

  // Unlinking stops songs appearing for everyone else, so the button asks
  // once rather than firing on the first tap.
  confirmingUnlink = signal(false);

  constructor(
    public auth: AuthService,
    public companion: CompanionService,
    public worker: CompanionWorkerService,
    private toast: ToastService
  ) {
    this.url = companion.url();
    this.token = companion.token();
  }

  // Asked on open rather than only after "Save and test": a companion set up
  // weeks ago has no health here yet, and what it can do — whether it has a
  // worker to link — is read off that answer.
  ngOnInit(): void {
    if (this.companion.configured() && !this.companion.health()) void this.companion.check();
  }

  async save(): Promise<void> {
    this.companion.configure(this.url, this.token);
    const health = await this.companion.check();
    if (health.ok && !health.error) this.toast.show(`Companion reachable — yt-dlp ${health.ytdlp}.`);
    else this.toast.error(health.error ?? 'The companion did not answer.');
  }

  // The Termux companion always listens here, so this saves typing an address
  // into a phone keyboard.
  useThisPhone(): void {
    this.url = 'http://127.0.0.1:8099';
  }

  forget(): void {
    this.companion.forget();
    this.url = '';
    this.token = '';
  }

  async linkWorker(): Promise<void> {
    const ok = await this.worker.enable();
    if (ok) this.toast.show('The companion will fetch requested songs on its own now.');
    else this.toast.error(this.worker.error() ?? 'Could not link the companion.');
  }

  async unlinkWorker(): Promise<void> {
    if (!this.confirmingUnlink()) {
      this.confirmingUnlink.set(true);
      setTimeout(() => this.confirmingUnlink.set(false), 5000);
      return;
    }
    this.confirmingUnlink.set(false);
    const ok = await this.worker.disable();
    if (ok) this.toast.show('Stopped. Requests are fulfilled only while the app is open.');
    else this.toast.error(this.worker.error() ?? 'Could not stop the companion worker.');
  }
}
