import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../shared/services/auth.service';

const EXPIRED_LINK =
  'That reset link is no longer valid — it may have expired or already been used. Ask for a new one from the sign-in page, and open it in the same browser you requested it from.';

// Landing page for the recovery link in the reset email.
//
// supabase-js (with detectSessionInUrl on) exchanges the `?code=` in the URL
// for a session while AuthService.init() runs, i.e. before the router gets
// here. So a signed-in user at this point means the link was good, and
// updateUser() can set the new password.
@Component({
  selector: 'app-auth-reset',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth-reset.html',
  styleUrl: './auth-reset.scss',
})
export class AuthResetComponent implements OnInit {
  ready = signal(false);
  busy = signal(false);
  error = signal('');
  notice = signal('');

  password = '';
  confirm = '';

  constructor(private auth: AuthService, private router: Router) {}

  ngOnInit(): void {
    const failure = this.linkError();
    if (failure) {
      this.error.set(failure);
      return;
    }
    if (!this.auth.signedIn()) {
      this.error.set(EXPIRED_LINK);
      return;
    }
    this.ready.set(true);
  }

  // Supabase reports a dead link as `error_description`, in the query string
  // (PKCE) or the hash (implicit). It may already have been stripped from the
  // URL by then, in which case the missing session tells the same story.
  private linkError(): string {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return search.get('error_description') || hash.get('error_description') ? EXPIRED_LINK : '';
  }

  async submit(): Promise<void> {
    if (this.busy() || !this.ready()) return;
    this.error.set('');
    this.notice.set('');

    if (this.password.length < 6) {
      this.error.set('Password is too weak — use at least 6 characters.');
      return;
    }
    if (this.password !== this.confirm) {
      this.error.set('The two passwords do not match.');
      return;
    }

    this.busy.set(true);
    const result = await this.auth.updatePassword(this.password);
    this.busy.set(false);

    if (!result.ok) {
      this.error.set(result.message);
      return;
    }
    this.notice.set('Password updated. Taking you to your library...');
    await this.router.navigateByUrl('/');
  }

  backToSignIn(): void {
    void this.router.navigateByUrl('/auth');
  }
}
