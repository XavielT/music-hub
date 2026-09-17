import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { ToastService } from './toast.service';
import { I18nService } from './i18n.service';

export type InviteLinkStatus = 'open' | 'used' | 'revoked' | 'expired';

export interface InviteLink {
  id: string;
  note: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  status: InviteLinkStatus;
}

/**
 * Invite links: a link that carries its own permission.
 *
 * Only the hash of a token is stored, so the raw token exists in exactly two
 * places — the message it was pasted into, and this service's `lastCreated`
 * signal until the admin leaves the screen. There is deliberately no way to
 * read an old one back; a lost link is revoked and replaced, not recovered.
 *
 * `invite_links` has RLS on with no policies and no grants, exactly like
 * `allowed_emails`: the three security definer functions are the only door,
 * and each checks `is_admin()` in its own body rather than trusting who holds
 * EXECUTE.
 */
@Injectable({ providedIn: 'root' })
export class InviteLinksService {
  private _links = signal<InviteLink[]>([]);
  links = this._links.asReadonly();

  private _loading = signal(false);
  loading = this._loading.asReadonly();

  private _busy = signal(false);
  busy = this._busy.asReadonly();

  // The token just minted, shown once. Cleared as soon as the panel is left.
  private _lastCreated = signal('');
  lastCreated = this._lastCreated.asReadonly();

  constructor(
    private supabase: SupabaseService,
    private toast: ToastService,
    private i18n: I18nService
  ) {}

  async load(): Promise<void> {
    this._loading.set(true);
    try {
      const { data, error } = await this.supabase.client.rpc('list_invite_links');
      if (error) throw new Error(error.message);
      this._links.set((data ?? []) as InviteLink[]);
    } catch (err) {
      // Same reasoning as the invites list: the section stays empty rather
      // than throwing a toast at somebody who only opened Settings.
      console.warn('listing invite links failed', err);
      this._links.set([]);
    } finally {
      this._loading.set(false);
    }
  }

  /** Returns the full URL to send, or '' if it could not be created. */
  async create(note: string, days = 7): Promise<string> {
    this._busy.set(true);
    try {
      const { data, error } = await this.supabase.client.rpc('create_invite_link', {
        p_note: note,
        p_days: days,
      });
      if (error) throw new Error(error.message);

      const token = String(data ?? '');
      if (!token) throw new Error('no token returned');

      const url = this.urlFor(token);
      this._lastCreated.set(url);
      await this.load();
      return url;
    } catch (err) {
      this.toast.error(this.friendly(err));
      return '';
    } finally {
      this._busy.set(false);
    }
  }

  async revoke(id: string): Promise<void> {
    this._busy.set(true);
    try {
      const { error } = await this.supabase.client.rpc('revoke_invite_link', { p_id: id });
      if (error) throw new Error(error.message);
      await this.load();
      this.toast.show(this.i18n.t('admin.inviteLinkRevoked'));
    } catch (err) {
      this.toast.error(this.friendly(err));
    } finally {
      this._busy.set(false);
    }
  }

  clearLastCreated(): void {
    this._lastCreated.set('');
  }

  /**
   * Built from the running origin rather than a constant, so a link made from
   * a preview deployment points at that preview instead of quietly sending
   * somebody to production.
   */
  private urlFor(token: string): string {
    return `${location.origin}/auth?invite=${encodeURIComponent(token)}`;
  }

  private friendly(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('admin')) return this.i18n.t('admin.inviteLinkNotAdmin');
    return message || this.i18n.t('admin.inviteLinkFailed');
  }
}
