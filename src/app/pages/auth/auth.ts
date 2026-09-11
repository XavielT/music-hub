import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../shared/services/auth.service';
import { InstallHint } from '../../../shared/components/install-hint/install-hint';

type AuthMode = 'login' | 'register' | 'forgot';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule, InstallHint],
  templateUrl: './auth.html',
  styleUrl: './auth.scss',
})
export class AuthComponent {
  mode = signal<AuthMode>('login');
  busy = signal(false);
  error = signal('');
  notice = signal('');

  email = '';
  password = '';
  displayName = '';

  constructor(private auth: AuthService, private router: Router, private route: ActivatedRoute) {
    // Landed here because the account was disabled mid-session, rather than by
    // signing out.
    const reason = this.auth.takeSignedOutReason();
    if (reason) this.error.set(reason);
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
        return this.auth.signUp(this.email, this.password, this.displayName);
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
    if (this.busy()) return 'Please wait...';
    if (this.mode() === 'login') return 'Sign in';
    return this.mode() === 'register' ? 'Create account' : 'Send reset link';
  }

  private validate(): string {
    if (!this.email.trim()) return 'Enter your email.';
    if (!this.email.includes('@')) return 'That email address does not look valid.';
    if (this.mode() === 'forgot') return '';
    if (!this.password) return 'Enter your password.';
    if (this.mode() === 'register') {
      if (this.password.length < 6) return 'Password is too weak — use at least 6 characters.';
      if (!this.displayName.trim()) return 'Enter a display name.';
    }
    return '';
  }
}
