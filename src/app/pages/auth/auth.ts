import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../shared/services/auth.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { InstallHint } from '../../../shared/components/install-hint/install-hint';
import { TPipe } from '../../../shared/i18n/t.pipe';

type AuthMode = 'login' | 'register' | 'forgot';

const INVITE_KEY = 'music-hub.invite';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule, InstallHint, TPipe],
  templateUrl: './auth.html',
  styleUrl: './auth.scss',
})
export class AuthComponent {
  mode = signal<AuthMode>('login');
  // Non-empty when this visit came from an invite link.
  inviteToken = signal('');
  busy = signal(false);
  error = signal('');
  notice = signal('');

  email = '';
  password = '';
  displayName = '';

  constructor(
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private i18n: I18nService
  ) {
    // Landed here because the account was disabled mid-session, rather than by
    // signing out.
    const reason = this.auth.takeSignedOutReason();
    if (reason) this.error.set(reason);

    // Arrived on an invite link. Open on the register form rather than the
    // sign-in one, because somebody following an invite has no account yet.
    const invited = this.readInviteToken();
    if (invited) {
      this.inviteToken.set(invited);
      this.mode.set('register');
    }
  }

  /**
   * The token survives in sessionStorage as well as the URL: Safari drops the
   * query string on some navigations, and losing it silently would put the
   * invitee back in front of the wall the link exists to remove.
   */
  private readInviteToken(): string {
    const fromUrl = this.route.snapshot.queryParamMap.get('invite')?.trim() ?? '';
    if (fromUrl) {
      try {
        sessionStorage.setItem(INVITE_KEY, fromUrl);
      } catch {
        // Private mode, or storage is full. The URL still has it.
      }
      return fromUrl;
    }
    try {
      return sessionStorage.getItem(INVITE_KEY)?.trim() ?? '';
    } catch {
      return '';
    }
  }

  setMode(mode: AuthMode): void {
    this.mode.set(mode);
    this.error.set('');
    this.notice.set('');
  }

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.error.set('');
    this.notice.set('');

    const validation = this.validate();
    if (validation) {
      this.error.set(validation);
      return;
    }

    this.busy.set(true);
    const result = await this.runMode();
    this.busy.set(false);

    if (!result.ok) {
      this.error.set(result.message);
      return;
    }

    // Password reset never signs anybody in here: the link in the email does.
    if (this.mode() === 'forgot') {
      this.setModeKeepingNotice('login', result.message);
      return;
    }

    // Sign-up on a project with email confirmation returns no session:
    // show the notice and let the user sign in afterwards.
    if (!this.auth.signedIn()) {
      this.setModeKeepingNotice('login', result.message);
      return;
    }

    const redirect = this.route.snapshot.queryParamMap.get('redirect');
    await this.router.navigateByUrl(redirect && !redirect.startsWith('/auth') ? redirect : '/');
  }

  private runMode() {
    switch (this.mode()) {
      case 'login':
        return this.auth.signIn(this.email, this.password);
      case 'register':
        return this.auth.signUp(this.email, this.password, this.displayName, this.inviteToken());
      case 'forgot':
        return this.auth.sendPasswordReset(this.email);
    }
  }

  private setModeKeepingNotice(mode: AuthMode, notice: string): void {
    this.setMode(mode);
    this.notice.set(notice);
    this.password = '';
  }

  submitLabel(): string {
    if (this.busy()) return this.i18n.t('auth.working');
    if (this.mode() === 'login') return this.i18n.t('auth.signIn');
    return this.i18n.t(this.mode() === 'register' ? 'auth.createAccount' : 'auth.sendResetLink');
  }

  private validate(): string {
    if (!this.email.trim()) return this.i18n.t('auth.enterEmail');
    if (!this.email.includes('@')) return this.i18n.t('auth.err.badEmail');
    if (this.mode() === 'forgot') return '';
    if (!this.password) return this.i18n.t('auth.enterPassword');
    if (this.mode() === 'register') {
      if (this.password.length < 6) return this.i18n.t('auth.err.weakPassword');
      if (!this.displayName.trim()) return this.i18n.t('auth.enterDisplayName');
    }
    return '';
  }
}
