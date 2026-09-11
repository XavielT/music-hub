import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CloudLibraryService } from './cloud-library.service';
import { I18nService } from './i18n.service';

export interface PendingSongRow {
  id: string;
  owner_id: string;
  title: string;
  artist: string;
  album: string;
  size_bytes: number;
  storage_path: string | null;
  cover_path: string | null;
  created_at: string;
  uploader: string;
}

/**
 * The queue of member uploads waiting to join the shared library.
 *
 * Approving is a one-column update, which the policy already restricts to
 * admins and the trigger refuses from anyone else — there is no Edge Function
 * here because there is no privileged key involved, only a rule the database
 * already enforces.
 *
 * Rejecting deletes the row and the audio. That is the destructive half, so the
 * panel asks first.
 */
@Injectable({ providedIn: 'root' })
export class PendingSongsService {
  private _items = signal<PendingSongRow[]>([]);
  items = this._items.asReadonly();

  private _loading = signal(false);
  loading = this._loading.asReadonly();

  private _busyWith = signal<string | null>(null);
  busyWith = this._busyWith.asReadonly();

  private _error = signal('');
  error = this._error.asReadonly();

  constructor(
    private supabase: SupabaseService,
    private cloud: CloudLibraryService,
    private i18n: I18nService
  ) {}

  async load(): Promise<void> {
    this._loading.set(true);
    try {
      // The uploader's name comes from the joined profile: a user id in a
      // review queue tells you nothing about whose song it is.
      const { data, error } = await this.supabase.client
        .from('songs')
        .select(
          'id, owner_id, title, artist, album, size_bytes, storage_path, cover_path, created_at, profiles(display_name)'
        )
        .eq('approved', false)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      this._items.set(
        (data ?? []).map(row => {
          const joined = row as Record<string, unknown> & {
            profiles?: { display_name?: string } | { display_name?: string }[] | null;
          };
          const profile = Array.isArray(joined.profiles) ? joined.profiles[0] : joined.profiles;
          return {
            ...(row as unknown as PendingSongRow),
            uploader: profile?.display_name || '',
          };
        })
      );
      this._error.set('');
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this._loading.set(false);
    }
  }

  async approve(id: string): Promise<boolean> {
    this._busyWith.set(id);
    try {
      const { error } = await this.supabase.client
        .from('songs')
        .update({ approved: true })
        .eq('id', id);
      if (error) throw new Error(error.message);
      this._items.set(this._items().filter(item => item.id !== id));
      return true;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      this._busyWith.set(null);
    }
  }

  /**
   * Removes the song and the bytes behind it.
   *
   * The objects go first: once the row is gone nothing records which files were
   * its, and they would sit in the bucket eating the shared quota with nothing
   * pointing at them.
   */
  async reject(item: PendingSongRow): Promise<boolean> {
    this._busyWith.set(item.id);
    try {
      await this.cloud.removeObjects(item.storage_path, item.cover_path);
      const { error } = await this.supabase.client.from('songs').delete().eq('id', item.id);
      if (error) throw new Error(error.message);
      this._items.set(this._items().filter(row => row.id !== item.id));
      return true;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      this._busyWith.set(null);
    }
  }
}
