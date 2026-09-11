import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { I18nService } from './i18n.service';
import { shrinkCover } from './tags';

/** One track's worth of metadata. Never audio — see the Edge Function's header. */
export interface LinkTrack {
  title: string;
  artist: string;
  album: string;
  year: number | null;
  durationSeconds: number;
  coverUrl: string | null;
}

export interface LinkResult {
  provider: 'spotify' | 'youtube';
  /** The album or playlist name, when the link was one of those. */
  album?: string;
  tracks: LinkTrack[];
}

/**
 * Fills in a song's details from a Spotify or YouTube link.
 *
 * Everything goes through the `link-metadata` Edge Function rather than being
 * fetched here, for two reasons that are both hard requirements: the Spotify
 * client secret cannot ship in a bundle anyone can read, and neither Spotify's
 * API nor the thumbnail hosts send CORS headers this origin would satisfy.
 *
 * Metadata only. Nothing in this file, or the function behind it, fetches or
 * exposes audio — a link is a way to fill in a title, not a way to get a song.
 */
@Injectable({ providedIn: 'root' })
export class LinkMetadataService {
  private _busy = signal(false);
  busy = this._busy.asReadonly();

  private _error = signal('');
  error = this._error.asReadonly();

  constructor(
    private supabase: SupabaseService,
    private i18n: I18nService
  ) {}

  /** Looks a link up. Returns null and sets `error()` when it could not. */
  async lookup(url: string): Promise<LinkResult | null> {
    const link = url.trim();
    if (!link) return null;
    this._busy.set(true);
    this._error.set('');
    try {
      const { data, error } = await this.supabase.client.functions.invoke('link-metadata', {
        body: { url: link },
      });
      if (error) {
        // supabase-js reports any non-2xx as "Edge Function returned a non-2xx
        // status code", which describes the transport and not the reason. The
        // function's own sentence is in the response body.
        this._error.set(await readError(error, this.i18n.t('link.failed')));
        return null;
      }
      const result = data as LinkResult;
      if (!result?.tracks?.length) {
        this._error.set(this.i18n.t('link.nothingFound'));
        return null;
      }
      return result;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      this._busy.set(false);
    }
  }

  /**
   * Fetches a cover as bytes, through the same function, and shrinks it the way
   * every other cover in the app is shrunk — so a link-filled cover is stored,
   * uploaded and displayed exactly like one lifted out of a file's own tags.
   */
  async cover(coverUrl: string | null): Promise<Blob | null> {
    if (!coverUrl) return null;
    try {
      const { data, error } = await this.supabase.client.functions.invoke('link-metadata', {
        body: { url: coverUrl, action: 'cover' },
      });
      if (error || !(data instanceof Blob) || !data.size) return null;
      return await shrinkCover(data);
    } catch {
      // A missing cover is not worth failing the whole fill over: the title and
      // artist are the part people came for.
      return null;
    }
  }

  clearError(): void {
    this._error.set('');
  }
}

// The function's sentence, dug out of the Response supabase-js wrapped.
async function readError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      // Not JSON — fall through.
    }
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
