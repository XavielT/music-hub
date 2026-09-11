import { Injectable, computed, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { CompanionService, WorkerStatus } from './companion.service';

// The account the companion signs in as. Fixed in the database function too —
// re-linking rotates its password rather than making a second account.
export const WORKER_EMAIL = 'companion.worker@music-hub.local';

/**
 * Turns the companion on this phone into one that works unattended.
 *
 * The in-app worker only runs while Music Hub is open, which makes "ask for a
 * song and it appears" true only when someone is already looking at their
 * phone. The Termux companion can do the whole job by itself — but to write to
 * the shared library it needs to be signed in, and it cannot borrow this
 * session: Supabase rotates refresh tokens, so two clients sharing one session
 * sign each other out within the hour.
 *
 * So it gets an account of its own. This service generates a password, has the
 * database create (or rotate) that account, and hands the credentials to the
 * companion over loopback. The password is never stored here and never shown:
 * the database keeps a hash, the phone keeps the only copy, and linking again
 * replaces it.
 *
 * The account is an admin, because adding to the shared library is an admin
 * act. That is the honest cost of the feature, and it is why linking is
 * admin-only and why the companion writes the password to a 0600 file.
 */
@Injectable({ providedIn: 'root' })
export class CompanionWorkerService {
  private _busy = signal(false);
  busy = this._busy.asReadonly();

  private _error = signal<string | null>(null);
  error = this._error.asReadonly();

  status = computed<WorkerStatus | null>(() => this.companion.health()?.worker ?? null);

  // Only the Termux companion has a worker; the hosted one reports no `worker`
  // at all, and offering the button there would promise something it cannot do.
  supported = computed(() => !!this.companion.health()?.worker);

  linked = computed(() => this.status()?.linked === true);

  // A sentence for the settings panel, in terms of what it means for the
  // people waiting on their songs.
  summary = computed(() => {
    const worker = this.status();
    if (!worker?.linked) return '';
    const done = `${worker.completed} fetched${worker.failed ? `, ${worker.failed} failed` : ''}`;
    if (worker.last_error) return `Signed in, but the last attempt failed: ${worker.last_error}`;
    if (!worker.signed_in) return `Linked as ${worker.account}, not signed in yet — ${done}.`;
    return `Working as ${worker.account} — ${done}.`;
  });

  constructor(
    private supabase: SupabaseService,
    private auth: AuthService,
    private companion: CompanionService
  ) {}

  /**
   * Create or rotate the worker account and hand it to the companion.
   *
   * Order matters: the password reaches the database first, so a companion
   * that answers `/link` with credentials it cannot use is a visible error
   * rather than an account nobody holds the password to.
   */
  async enable(): Promise<boolean> {
    if (!this.auth.isAdmin() || this._busy()) return false;
    this._busy.set(true);
    this._error.set(null);
    try {
      const password = generatePassword();
      const { data, error } = await this.supabase.client.rpc('provision_worker', {
        p_password: password,
      });
      if (error) throw new Error(error.message);
      await this.companion.link({
        supabase_url: environment.supabaseUrl,
        anon_key: environment.supabaseAnonKey,
        email: (data as string) || WORKER_EMAIL,
        password,
      });
      return true;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      this._busy.set(false);
    }
  }

  /**
   * Stop the unattended worker.
   *
   * Only the companion forgets: the account stays, so turning this back on is
   * one tap rather than a re-provision, and its uploads keep their owner.
   */
  async disable(): Promise<boolean> {
    if (this._busy()) return false;
    this._busy.set(true);
    this._error.set(null);
    try {
      await this.companion.unlink();
      return true;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      this._busy.set(false);
    }
  }
}

/**
 * A password nobody types and nobody has to remember.
 *
 * 32 bytes from the platform's CSPRNG, so it is a random secret rather than
 * anything derived from the account it belongs to. The database refuses
 * anything under 24 characters, which this comfortably clears.
 */
function generatePassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
