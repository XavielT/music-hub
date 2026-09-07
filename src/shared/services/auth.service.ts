import { Injectable, computed, signal } from '@angular/core';
import { Session, User } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY, SupabaseService } from './supabase.service';
import { ProfileModel } from '../models/profile.model';

export interface AuthResult {
  ok: boolean;
  // Friendly, user-facing message ('' when there is nothing to show).
  message: string;
}

// How long we wait for Supabase to resolve the stored session before opening
// the app anyway. Offline the token refresh can hang, and the app must never
// hard-block on a network call.
const SESSION_TIMEOUT_MS = 4000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _user = signal<User | null>(null);
  user = this._user.asReadonly();

  private _profile = signal<ProfileModel | null>(null);
  profile = this._profile.asReadonly();

  private _loading = signal(true);
  loading = this._loading.asReadonly();

  signedIn = computed(() => this._user() !== null);
  // Best label we have for the current user: display name, else email.
  displayName = computed(() => this._profile()?.display_name?.trim() || this._user()?.email || '');

  private initialized = false;

  constructor(private supabase: SupabaseService) {}

  // Restores the session (from storage, no network needed) and keeps the
  // signals in sync afterwards. Safe to call more than once.
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      this.applySession(session);
    });

    try {
      const session = await this.withTimeout(
        this.supabase.client.auth.getSession().then(({ data }) => data.session)
      );
      this.applySession(session);
    } catch {
      // Offline (or Supabase unreachable): fall back to whatever session is
      // still in storage so an already-signed-in user gets into the app.
      this.applySession(this.storedSession());
    } finally {
      this._loading.set(false);
    }
  }

  async signUp(email: string, password: string, displayName: string): Promise<AuthResult> {
    this._loading.set(true);
    try {
      const { data, error } = await this.supabase.client.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayName.trim() } },
      });
      if (error) return { ok: false, message: this.friendlyError(error) };

      // No session means email confirmation is enabled on the project.
      if (!data.session) {
        return { ok: true, message: 'Check your inbox to confirm your email, then sign in.' };
      }

      this.applySession(data.session);
      await this.ensureProfile(data.session.user, displayName.trim());
      return { ok: true, message: '' };
    } catch (err) {
      return { ok: false, message: this.friendlyError(err) };
    } finally {
      this._loading.set(false);
    }
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    this._loading.set(true);
    try {
      const { data, error } = await this.supabase.client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) return { ok: false, message: this.friendlyError(error) };

      this.applySession(data.session);
      await this.ensureProfile(data.session.user);
      return { ok: true, message: '' };
    } catch (err) {
      return { ok: false, message: this.friendlyError(err) };
    } finally {
      this._loading.set(false);
    }
  }

  // Sends the recovery email. The link lands on /auth/reset, where the PKCE
  // code is exchanged for a session and the new password can be set.
  async sendPasswordReset(email: string): Promise<AuthResult> {
    this._loading.set(true);
    try {
      const { error } = await this.supabase.client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/reset`,
      });
      if (error) return { ok: false, message: this.friendlyError(error) };
      return { ok: true, message: 'Reset link sent — check your inbox (and the spam folder).' };
    } catch (err) {
      return { ok: false, message: this.friendlyError(err) };
    } finally {
      this._loading.set(false);
    }
  }

  // Called from /auth/reset once the recovery link has signed the user in.
  async updatePassword(password: string): Promise<AuthResult> {
    this._loading.set(true);
    try {
      const { data, error } = await this.supabase.client.auth.updateUser({ password });
      if (error) return { ok: false, message: this.friendlyError(error) };
      if (data.user) this._user.set(data.user);
      return { ok: true, message: '' };
    } catch (err) {
      return { ok: false, message: this.friendlyError(err) };
    } finally {
      this._loading.set(false);
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.supabase.client.auth.signOut();
    } catch {
      // Offline: drop the stored session by hand so the user is really out.
      try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      } catch {
        /* storage unavailable — nothing else we can do */
      }
    }
    this.applySession(null);
  }

  // Reloads the profile row for the signed-in user (no-op when signed out).
  async refreshProfile(): Promise<void> {
    const user = this._user();
    if (user) await this.loadProfile(user.id);
  }

  private applySession(session: Session | null): void {
    const user = session?.user ?? null;
    const previousId = this._user()?.id;
    this._user.set(user);

    if (!user) {
      this._profile.set(null);
      return;
    }
    // Fetch the profile in the background: it needs the network and must not
    // delay opening the app.
    if (user.id !== previousId || this._profile() === null) void this.loadProfile(user.id);
  }

  private async loadProfile(userId: string): Promise<void> {
    try {
      const { data, error } = await this.supabase.client
        .from('profiles')
        .select('id, display_name, created_at')
        .eq('id', userId)
        .maybeSingle();
      if (!error && data) this._profile.set(data as ProfileModel);
    } catch {
      // Offline: keep whatever we have, the UI falls back to the email.
    }
  }

  // The checklist SQL installs a trigger that creates the profile row on
  // signup. This is the safety net for projects where it is missing.
  private async ensureProfile(user: User, displayName?: string): Promise<void> {
    try {
      const { data } = await this.supabase.client
        .from('profiles')
        .select('id, display_name, created_at')
        .eq('id', user.id)
        .maybeSingle();

      if (data) {
        this._profile.set(data as ProfileModel);
        return;
      }

      const fallbackName =
        displayName || (user.user_metadata?.['display_name'] as string | undefined) || '';
      const { data: inserted } = await this.supabase.client
        .from('profiles')
        .insert({ id: user.id, display_name: fallbackName })
        .select('id, display_name, created_at')
        .maybeSingle();
      if (inserted) this._profile.set(inserted as ProfileModel);
    } catch {
      // Non-fatal: the account works, only the profile row is missing.
    }
  }

  // Reads the session supabase-js persisted in localStorage, used when the
  // network is down and getSession() cannot answer.
  private storedSession(): Session | null {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { currentSession?: unknown };
      const session = (parsed.currentSession ?? parsed) as Session | null;
      return session?.user ? session : null;
    } catch {
      return null;
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('auth-timeout')), SESSION_TIMEOUT_MS);
      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        err => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  private friendlyError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw.toLowerCase();

    // The invite-only trigger on auth.users (S1) raises its own message, but
    // GoTrue usually swallows it and answers 500 "Database error saving new
    // user" instead — verified against the live project. That trigger is the
    // only thing that can fail the insert (the profile trigger swallows
    // conflicts), so both spellings mean the same thing to the user.
    if (message.includes('invite-only') || message.includes('database error saving new user'))
      return 'Sign-ups are invite-only. Ask Xaviel to add your email, then register.';
    if (message.includes('invalid login credentials')) return 'Wrong email or password.';
    if (message.includes('email not confirmed')) return 'Confirm your email first, then sign in.';
    if (message.includes('already registered') || message.includes('already been registered'))
      return 'That email is already registered. Try signing in instead.';
    if (message.includes('user already exists')) return 'That email is already registered. Try signing in instead.';
    if (message.includes('password should be') || message.includes('weak password'))
      return 'Password is too weak — use at least 6 characters.';
    if (message.includes('unable to validate email') || message.includes('invalid email'))
      return 'That email address does not look valid.';
    // A recovery link that was already used, has expired, or was opened in a
    // different browser than the one that asked for it.
    if (
      message.includes('expired') ||
      message.includes('invalid flow state') ||
      message.includes('code verifier') ||
      message.includes('code challenge') ||
      message.includes('auth session missing') ||
      message.includes('invalid or has expired')
    )
      return 'That reset link is no longer valid. Ask for a new one from the sign-in page (open it in the same browser you requested it from).';
    if (message.includes('same as the old') || message.includes('should be different'))
      return 'Choose a password different from your current one.';
    if (message.includes('rate limit') || message.includes('too many'))
      return 'Too many attempts. Wait a minute and try again.';
    if (message.includes('failed to fetch') || message.includes('network') || message.includes('timeout'))
      return 'No connection to the server. Check your internet and try again.';
    return raw || 'Something went wrong. Try again.';
  }
}
