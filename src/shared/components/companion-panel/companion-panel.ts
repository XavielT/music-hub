import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { CompanionService } from '../../services/companion.service';
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
export class CompanionPanel {
  url: string;
  token: string;
  // The token is write-only in practice: shown masked, replaced when retyped.
  revealed = signal(false);

  constructor(
    public auth: AuthService,
    public companion: CompanionService,
    private toast: ToastService
  ) {
    this.url = companion.url();
    this.token = companion.token();
  }

  async save(): Promise<void> {
    this.companion.configure(this.url, this.token);
    const health = await this.companion.check();
    if (health.ok && !health.error) this.toast.show(`Companion reachable — yt-dlp ${health.ytdlp}.`);
    else this.toast.error(health.error ?? 'The companion did not answer.');
  }

  forget(): void {
    this.companion.forget();
    this.url = '';
    this.token = '';
  }
}
