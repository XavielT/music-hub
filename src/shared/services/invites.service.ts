import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { ToastService } from './toast.service';

export interface Invite {
  email: string;
  note: string;
  created_at: string;
  // Whether an account has actually been created for this address.
  has_joined: boolean;
}

// Managing who is allowed to sign up. `allowed_emails` has RLS on with no
// policies and no grants, so the list is not readable through the API at all —
// these three `security definer` functions are the only door, and each one
// checks `is_admin()` in its own body rather than trusting who holds EXECUTE.
//
// So there is nothing to hide here: a member who reached this by other means
// gets an error from Postgres, not a filtered list.
@Injectable({ providedIn: 'root' })
export class InvitesService {
  private _invites = signal<Invite[]>([]);
  invites = this._invites.asReadonly();

  private _loading = signal(false);
  loading = this._loading.asReadonly();

  private _busy = signal(false);
  busy = this._busy.asReadonly();

  constructor(private supabase: SupabaseService, private toast: ToastService) {}

  async load(): Promise<void> {
    this._loading.set(true);
    try {
      const { data, error } = await this.supabase.client.rpc('list_invites');
      if (error) throw new Error(error.message);
      this._invites.set((data ?? []) as Invite[]);
    } catch (err) {
      // Not worth a toast on the way into settings: the section simply stays
      // empty, and the failure is in the console for anyone looking.
      console.warn('listing invites failed', err);
      this._invites.set([]);
    } finally {
      this._loading.set(false);
    }
  }

  async add(email: string, note: string): Promise<boolean> {
    if (!email.trim()) return false;
    this._busy.set(true);
    try {
      const { error } = await this.supabase.client.rpc('add_invite', {
        p_email: email,
        p_note: note,
      });
      if (error) throw new Error(error.message);
      await this.load();
      this.toast.show(`${email.trim().toLowerCase()} can register now.`);
      return true;
    } catch (err) {
      this.toast.error(this.friendly(err));
      return false;
    } finally {
      this._busy.set(false);
    }
  }

  async remove(email: string): Promise<void> {
    this._busy.set(true);
    try {
      const { error } = await this.supabase.client.rpc('remove_invite', { p_email: email });
      if (error) throw new Error(error.message);
      await this.load();
    } catch (err) {
      this.toast.error(this.friendly(err));
    } finally {
      this._busy.set(false);
    }
  }

  // The functions raise their own sentences, which are already written for
  // someone reading them. Anything else is a connection problem.
  private friendly(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    return /invite|admin|email address/i.test(message)
      ? message
      : 'Could not reach the server — try again when you have a connection.';
  }
}
