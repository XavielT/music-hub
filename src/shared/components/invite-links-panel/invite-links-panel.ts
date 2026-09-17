import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { InviteLinksService } from '../../services/invite-links.service';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../i18n/t.pipe';

/**
 * Making an invite link, and seeing the ones already out there.
 *
 * A link is shown exactly once, when it is made. There is no way to read an
 * old one back — the database keeps only a hash — so the copy button is the
 * moment that matters, and the panel says so.
 */
@Component({
  selector: 'app-invite-links-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, TPipe],
  templateUrl: './invite-links-panel.html',
  styleUrl: './invite-links-panel.scss',
})
export class InviteLinksPanel implements OnInit, OnDestroy {
  note = '';
  copied = signal(false);

  // Revoking is one tap away from a list, so it asks first.
  confirming = signal<string | null>(null);

  constructor(
    public auth: AuthService,
    public inviteLinks: InviteLinksService,
    private toast: ToastService,
    private i18n: I18nService
  ) {}

  ngOnInit(): void {
    if (this.auth.isAdmin()) void this.inviteLinks.load();
  }

  ngOnDestroy(): void {
    // The token is not recoverable, so it should not sit around on a screen
    // somebody wandered away from either.
    this.inviteLinks.clearLastCreated();
  }

  async create(): Promise<void> {
    this.copied.set(false);
    const url = await this.inviteLinks.create(this.note);
    if (url) this.note = '';
  }

  async copy(): Promise<void> {
    const url = this.inviteLinks.lastCreated();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
      this.toast.show(this.i18n.t('admin.inviteLinkCopied'));
    } catch {
      // Clipboard blocked (it needs a secure context and a user gesture, and
      // an iPhone withholds it often enough to matter). The link is on screen
      // and selectable, which is the fallback anybody reaches for anyway.
      this.toast.error(this.i18n.t('admin.inviteLinkCopyFailed'));
    }
  }

  async revoke(id: string): Promise<void> {
    if (this.confirming() !== id) {
      this.confirming.set(id);
      return;
    }
    this.confirming.set(null);
    await this.inviteLinks.revoke(id);
  }

  statusKey(status: string): string {
    return `admin.inviteLinkStatus.${status}`;
  }
}
