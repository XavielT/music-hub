import { Injectable, computed, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { UserRole } from '../models/profile.model';

// One row of the admin panel's user table. Shaped by `admin_user_overview()`,
// which is where the email and the per-user totals come from: the app cannot
// read auth.users, and counting songs per owner from here would be one query
// per person.
export interface AdminUserRow {
  id: string;
  email: string | null;
  display_name: string;
  role: UserRole;
  disabled: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  song_count: number;
  bytes_used: number;
}

/**
 * The admin panel's data and its four privileged actions.
 *
 * Nothing here is trusted. The listing is a `security definer` function that
 * checks `is_admin()` itself, and the four actions go to the `admin-users`
 * Edge Function, which re-checks the caller before touching anything with the
 * service_role key. That key never reaches this app — which is the whole
 * reason those actions are not just Supabase calls from here.
 */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private _users = signal<AdminUserRow[]>([]);
  users = this._users.asReadonly();

  private _loading = signal(false);
  loading = this._loading.asReadonly();

  // The id of the user an action is running against, so a row can show its own
  // spinner instead of the whole table freezing.
  private _busyWith = signal<string | null>(null);
  busyWith = this._busyWith.asReadonly();

  private _error = signal<string | null>(null);
  error = this._error.asReadonly();

  totalSongs = computed(() => this._users().reduce((n, u) => n + u.song_count, 0));
  totalBytes = computed(() => this._users().reduce((n, u) => n + u.bytes_used, 0));

  constructor(
    private supabase: SupabaseService,
    private auth: AuthService
  ) {}

  async load(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const { data, error } = await this.supabase.client.rpc('admin_user_overview');
      if (error) throw new Error(error.message);
      this._users.set((data ?? []) as AdminUserRow[]);
    } catch (err) {
      this._error.set(message(err));
    } finally {
      this._loading.set(false);
    }
  }

  setRole(userId: string, role: UserRole): Promise<boolean> {
    return this.act(userId, { action: 'set-role', userId, role });
  }

  setDisabled(userId: string, disabled: boolean): Promise<boolean> {
    return this.act(userId, { action: 'set-disabled', userId, disabled });
  }

  deleteUser(userId: string): Promise<boolean> {
    return this.act(userId, { action: 'delete-user', userId });
  }

  sendReset(userId: string): Promise<boolean> {
    return this.act(userId, { action: 'send-reset', userId }, { reload: false });
  }

  /**
   * Call the function and reload, so the table shows what the database now
   * says rather than what this device asked for. A refused action leaves the
   * table exactly as it was.
   */
  private async act(
    userId: string,
    body: Record<string, unknown>,
    options: { reload?: boolean } = {}
  ): Promise<boolean> {
    this._busyWith.set(userId);
    this._error.set(null);
    try {
      const { data, error } = await this.supabase.client.functions.invoke('admin-users', { body });
      // A non-2xx comes back as an error whose body holds the sentence the
      // function wrote; without this the user gets "Edge Function returned a
      // non-2xx status code", which says nothing.
      if (error) throw new Error(await detail(error));
      const failed = (data as { error?: string } | null)?.error;
      if (failed) throw new Error(failed);
      if (options.reload !== false) await this.load();
      return true;
    } catch (err) {
      this._error.set(message(err));
      return false;
    } finally {
      this._busyWith.set(null);
    }
  }

  // Guard rails the panel also shows as disabled buttons — the real ones are
  // in the database and the function.
  isSelf(userId: string): boolean {
    return this.auth.user()?.id === userId;
  }
}

// supabase-js wraps a non-2xx in a FunctionsHttpError whose `context` is the
// original Response, so the sentence is one await away.
async function detail(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      // Not JSON: fall through to the generic message.
    }
  }
  return message(error);
}

function message(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|load failed/i.test(text)
    ? 'No connection — try again in a moment.'
    : text;
}
