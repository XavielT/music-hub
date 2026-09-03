import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../shared/services/auth.service';

type AuthMode = 'login' | 'register';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
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

  constructor(private auth: AuthService, private router: Router, private route: ActivatedRoute) {}

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
    const result =
      this.mode() === 'login'
        ? await this.auth.signIn(this.email, this.password)
        : await this.auth.signUp(this.email, this.password, this.displayName);
    this.busy.set(false);

    if (!result.ok) {
      this.error.set(result.message);
      return;
    }

    // Sign-up on a project with email confirmation returns no session:
    // show the notice and let the user sign in afterwards.
    if (!this.auth.signedIn()) {
      this.notice.set(result.message);
      this.setModeKeepingNotice('login');
      return;
    }

    const redirect = this.route.snapshot.queryParamMap.get('redirect');
    await this.router.navigateByUrl(redirect && !redirect.startsWith('/auth') ? redirect : '/');
  }

  private setModeKeepingNotice(mode: AuthMode): void {
    const notice = this.notice();
    this.setMode(mode);
    this.notice.set(notice);
    this.password = '';
  }

  private validate(): string {
    if (!this.email.trim()) return 'Enter your email.';
    if (!this.email.includes('@')) return 'That email address does not look valid.';
    if (!this.password) return 'Enter your password.';
    if (this.mode() === 'register') {
      if (this.password.length < 6) return 'Password is too weak — use at least 6 characters.';
      if (!this.displayName.trim()) return 'Enter a display name.';
    }
    return '';
  }
}
