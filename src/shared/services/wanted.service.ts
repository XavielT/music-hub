import { Injectable, computed, effect, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { I18nService } from './i18n.service';
import { LinkTrack } from './link-metadata.service';

export interface WantedSong {
  id: string;
  owner_id: string;
  title: string;
  artist: string;
  album: string;
  cover_url: string | null;
  source_url: string | null;
  created_at: string;
  acquired: boolean;
}

const COLUMNS = 'id, owner_id, title, artist, album, cover_url, source_url, created_at, acquired';

/**
 * The wish list: songs somebody wants, which nothing here will fetch.
 *
 * It is a notepad with covers on it. Adding a row downloads nothing and grows
 * no library — which is why a listener gets one too, and why the empty state
 * says out loud that the audio has to come from your own files.
 *
 * Cloud-only, deliberately: unlike the library there is no offline story worth
 * the complexity, and a list that is wrong on one device is worse than a list
 * that is briefly unavailable.
 */
@Injectable({ providedIn: 'root' })
export class WantedService {
  private _items = signal<WantedSong[]>([]);
  items = this._items.asReadonly();

  private _loading = signal(false);
  loading = this._loading.asReadonly();

  private _busy = signal(false);
  busy = this._busy.asReadonly();

  private _error = signal('');
  error = this._error.asReadonly();

  // Still wanted first, then the ones already found — a list you act on, with
  // the done ones kept as a record rather than thrown away.
  pending = computed(() => this._items().filter(item => !item.acquired));
  acquired = computed(() => this._items().filter(item => item.acquired));

  constructor(
    private supabase: SupabaseService,
    private auth: AuthService,
    private i18n: I18nService
  ) {
    // Follows the session: a different account has a different list, and a
    // signed-out one has none at all.
    effect(() => {
      const user = this.auth.user();
      if (user) void this.load();
      else this._items.set([]);
    });
  }

  async load(): Promise<void> {
    if (!this.auth.user()) return;
    this._loading.set(true);
    try {
      const { data, error } = await this.supabase.client
        .from('wanted_songs')
        .select(COLUMNS)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      this._items.set((data ?? []) as WantedSong[]);
      this._error.set('');
    } catch (err) {
      // Offline, or a disabled account reading zero rows. The list on screen
      // stays as it was rather than emptying itself.
      console.warn('loading the wanted list failed', err);
    } finally {
      this._loading.set(false);
    }
  }

  /** Adds one or many — an album link fills the list in a single action. */
  async add(tracks: LinkTrack[], sourceUrl: string): Promise<boolean> {
    const user = this.auth.user();
    if (!user || !tracks.length) return false;
    this._busy.set(true);
    this._error.set('');
    try {
      const rows = tracks.map(track => ({
        owner_id: user.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        cover_url: track.coverUrl,
        source_url: sourceUrl,
      }));
      const { error } = await this.supabase.client.from('wanted_songs').insert(rows);
      if (error) throw new Error(error.message);
      await this.load();
      return true;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : this.i18n.t('err.noConnectionMoment'));
      return false;
    } finally {
      this._busy.set(false);
    }
  }

  async setAcquired(id: string, acquired: boolean): Promise<void> {
    // Optimistic: it is a checkbox on a private list, and reloading afterwards
    // puts it right if the write was refused.
    this._items.set(this._items().map(item => (item.id === id ? { ...item, acquired } : item)));
    try {
      const { error } = await this.supabase.client
        .from('wanted_songs')
        .update({ acquired })
        .eq('id', id);
      if (error) throw new Error(error.message);
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : String(err));
      await this.load();
    }
  }

  async remove(id: string): Promise<void> {
    const before = this._items();
    this._items.set(before.filter(item => item.id !== id));
    try {
      const { error } = await this.supabase.client.from('wanted_songs').delete().eq('id', id);
      if (error) throw new Error(error.message);
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : String(err));
      this._items.set(before);
    }
  }

  /**
   * The still-wanted entry matching a title and artist, if there is one.
   *
   * Uses the same normalisation as the library's duplicate check, so "Tú Me
   * Dejaste De Querer" off a file matches "tu me dejaste de querer" off a
   * Spotify link. Only pending entries match: re-adding a song you already
   * ticked off should not un-tick it.
   */
  matchFor(title: string, artist: string): WantedSong | null {
    const wantedTitle = normalise(title);
    if (!wantedTitle) return null;
    const wantedArtist = normalise(artist);
    return (
      this.pending().find(
        item =>
          normalise(item.title) === wantedTitle &&
          // An artist that is blank on either side is not evidence of a
          // mismatch — plenty of files carry no artist tag at all.
          (!wantedArtist || !normalise(item.artist) || normalise(item.artist) === wantedArtist)
      ) ?? null
    );
  }
}

// Same shape as the library's own normaliser: case, accents and punctuation all
// removed, because none of them are what makes two songs different.
function normalise(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}
