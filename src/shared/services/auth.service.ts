import { Injectable, computed, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { EmailOtpType, Session, User } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY, SupabaseService } from './supabase.service';
import { ProfileModel, UserRole } from '../models/profile.model';
import { I18nService } from './i18n.service';
import { environment } from '../../environments/environment';

export interface AuthResult {
  ok: boolean;
  // Friendly, user-facing message ('' when there is nothing to show).
  message: string;
}

// How long we wait for Supabase to resolve the stored session before opening
// the app anyway. Offline the token refresh can hang, and the app must never
// hard-block on a network call.
const SESSION_TIMEOUT_MS = 4000;

const PROFILE_COLUMNS =
  'id, display_name, created_at, is_admin, role, disabled, language, onboarded_at';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _user = signal<User | null>(null);
  user = this._user.asReadonly();

  private _profile = signal<ProfileModel | null>(null);
  profile = this._profile.asReadonly();

  private _loading = signal(true);
  loading = this._loading.asReadonly();

  signedIn = computed(() => this._user() !== null);
  // Only admins may write to the shared cloud library. Defaults to false while
  // the profile is still loading (or offline), so the UI never offers an upload
  // that the database would reject.
  isAdmin = computed(() => this.role() === 'admin' && !this.disabled());

  // Defaults to 'member' while the profile is loading: the most cautious
  // reading that still lets someone use the app.
  role = computed<UserRole>(() => this._profile()?.role ?? 'member');
  disabled = computed(() => this._profile()?.disabled === true);
  // A listener may play everything and download for offline, but the library
  // is read-only to them.
  canAddToLibrary = computed(() => this.role() !== 'listener' && !this.disabled());
  // Best label we have for the current user: display name, else email.
  displayName = computed(() => this._profile()?.display_name?.trim() || this._user()?.email || '');

  // Why the last sign-out happened, when it was not the user's idea. Read once
  // by the auth screen and cleared, so it explains itself instead of looking
  // like the session simply expired.
  private _signedOutReason = signal('');
  signedOutReason = this._signedOutReason.asReadonly();

  private initialized = false;

  constructor(
    private supabase: SupabaseService,
    private i18n: I18nService
  ) {}

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

  /**
   * `inviteToken` is the one from an invite link. It travels as sign-up
   * metadata because the only place it can be checked is inside the trigger on
   * auth.users, which is the same statement that creates the account — so the
   * link is spent exactly when the account is made, or not at all.
   */
  async signUp(
    email: string,
    password: string,
    displayName: string,
    inviteToken = ''
  ): Promise<AuthResult> {
    this._loading.set(true);
    try {
      const { data, error } = await this.supabase.client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            display_name: displayName.trim(),
            ...(inviteToken.trim() ? { invite_token: inviteToken.trim() } : {}),
          },
        },
      });
      if (error) return { ok: false, message: this.friendlyError(error) };

      // No session means email confirmation is enabled on the project.
      if (!data.session) {
        return { ok: true, message: this.i18n.t('auth.confirmEmail') };
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
        redirectTo: `${this.resetOrigin()}/auth/reset`,
      });
      if (error) return { ok: false, message: this.friendlyError(error) };
      return { ok: true, message: this.i18n.t('auth.resetSent') };
    } catch (err) {
      return { ok: false, message: this.friendlyError(err) };
    } finally {
      this._loading.set(false);
    }
  }

  // Inside the Capacitor WebView the origin is https://localhost, which is not
  // a place an email link can go, so the native app points recovery links at
  // the deployed site instead. On the web the current origin is right, and
  // keeps localhost working during development.
  private resetOrigin(): string {
    return Capacitor.isNativePlatform() ? environment.siteUrl : window.location.origin;
  }

  // Exchanges the `token_hash` from a recovery email for a session. Unlike the
  // PKCE code, this needs nothing stored in the browser, so the link works
  // wherever it is opened — a phone mail app included.
  async verifyRecoveryToken(tokenHash: string): Promise<AuthResult> {
    this._loading.set(true);
    try {
      const { data, error } = await this.supabase.client.auth.verifyOtp({
        token_hash: tokenHash,
        // Hardcoded rather than read from the URL: this page only ever
        // handles password recovery.
        type: 'recovery' as EmailOtpType,
      });
      if (error) return { ok: false, message: this.friendlyError(error) };
      this.applySession(data.session);
      return { ok: true, message: '' };
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

  /**
   * Stores the language on the profile. Best-effort on purpose: the caller has
   * already applied it locally, and a failed write offline should not undo a
   * choice the user just made and can see on screen.
   */
  async saveLanguage(language: 'es' | 'en'): Promise<void> {
    const user = this._user();
    if (!user) return;
    try {
      await this.supabase.client.from('profiles').update({ language }).eq('id', user.id);
      const profile = this._profile();
      if (profile) this._profile.set({ ...profile, language });
    } catch {
      // Offline: the device copy carries it until the next successful write.
    }
  }

  /** Records that the welcome box has been finished or skipped. */
  async markOnboarded(): Promise<void> {
    const user = this._user();
    if (!user) return;
    const when = new Date().toISOString();
    try {
      await this.supabase.client.from('profiles').update({ onboarded_at: when }).eq('id', user.id);
    } catch {
      // The local flag still stops it reappearing on this device.
    }
    const profile = this._profile();
    if (profile) this._profile.set({ ...profile, onboarded_at: when });
  }

  /** Used by the welcome box, which asks for the name it will show. */
  async saveDisplayName(displayName: string): Promise<void> {
    const user = this._user();
    const name = displayName.trim();
    if (!user || !name) return;
    try {
      await this.supabase.client.from('profiles').update({ display_name: name }).eq('id', user.id);
      const profile = this._profile();
      if (profile) this._profile.set({ ...profile, display_name: name });
    } catch {
      // Non-fatal: the name in the cloud stays as it was.
    }
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

  // Read and cleared by the auth screen: it is news exactly once.
  takeSignedOutReason(): string {
    const reason = this._signedOutReason();
    if (reason) this._signedOutReason.set('');
    return reason;
  }

  private async loadProfile(userId: string): Promise<void> {
    try {
      const { data, error } = await this.supabase.client
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', userId)
        .maybeSingle();
      if (error || !data) return;
      const profile = data as ProfileModel;
      this._profile.set(profile);
      // The profile outranks the device: it is what makes the choice follow
      // you to a browser that has never seen you.
      this.i18n.applyRemote(profile.language);
      // Every policy already refuses a disabled account, so staying signed in
      // would mean an app that loads and then shows nothing, which reads as a
      // bug rather than as a decision somebody made.
      if (profile.disabled) {
        this._signedOutReason.set(this.i18n.t('auth.accountDisabled'));
        await this.signOut();
      }
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
        .select(PROFILE_COLUMNS)
        .eq('id', user.id)
        .maybeSingle();

      if (data) {
        const existing = data as ProfileModel;
        this._profile.set(existing);
        this.i18n.applyRemote(existing.language);
        return;
      }

      const fallbackName =
        displayName || (user.user_metadata?.['display_name'] as string | undefined) || '';
      const { data: inserted } = await this.supabase.client
        .from('profiles')
        .insert({ id: user.id, display_name: fallbackName })
        .select(PROFILE_COLUMNS)
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

  /**
   * Maps whatever Supabase said to one of our own sentences.
   *
   * Returns a translated string rather than a key, because the caller only
   * ever displays it. Anything unrecognised falls through as the server's own
   * text, which is at least specific even when it is English.
   */
  private friendlyError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw.toLowerCase();

    // The invite-only trigger on auth.users (S1) raises its own message, but
    // GoTrue usually swallows it and answers 500 "Database error saving new
    // user" instead — verified against the live project. That trigger is the
    // only thing that can fail the insert (the profile trigger swallows
    // conflicts), so both spellings mean the same thing to the user.
    if (message.includes('invite-only') || message.includes('database error saving new user'))
      return this.i18n.t('auth.err.inviteOnly');
    if (message.includes('invalid login credentials')) return this.i18n.t('auth.err.badCredentials');
    if (message.includes('email not confirmed')) return this.i18n.t('auth.err.unconfirmed');
    if (
      message.includes('already registered') ||
      message.includes('already been registered') ||
      message.includes('user already exists')
    )
      return this.i18n.t('auth.err.alreadyRegistered');
    if (message.includes('password should be') || message.includes('weak password'))
      return this.i18n.t('auth.err.weakPassword');
    if (message.includes('unable to validate email') || message.includes('invalid email'))
      return this.i18n.t('auth.err.badEmail');
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
      return this.i18n.t('auth.err.staleLink');
    if (message.includes('same as the old') || message.includes('should be different'))
      return this.i18n.t('auth.err.samePassword');
    if (message.includes('rate limit') || message.includes('too many'))
      return this.i18n.t('auth.err.rateLimited');
    if (message.includes('failed to fetch') || message.includes('network') || message.includes('timeout'))
      return this.i18n.t('auth.err.offline');
    return raw || this.i18n.t('auth.err.generic');
  }
}
