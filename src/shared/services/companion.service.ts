import { Injectable, computed, signal } from '@angular/core';
import { YoutubeResult } from './youtube.service';

const URL_KEY = 'music-hub.companion-url';
const TOKEN_KEY = 'music-hub.companion-token';

export interface CompanionHealth {
  ok: boolean;
  ytdlp?: string;
  cookies?: boolean;
  // Filled in when the check failed, for the settings panel to show.
  error?: string;
}

/**
 * Talks to the yt-dlp companion (see `companion/`).
 *
 * YouTube stopped serving playable audio URLs to the clients a browser or a
 * WebView can be, so the download has to happen somewhere yt-dlp can be kept
 * current. Search goes the same way when the companion is configured, because
 * the in-app search only works inside the Android shell — in a browser CORS
 * blocks it, and the button is dead.
 *
 * The address and token live in localStorage per device rather than in the
 * database. The token is a credential for a service that downloads on your
 * behalf, and syncing it to every device through a shared library that other
 * members can read would be handing it to them.
 */
@Injectable({ providedIn: 'root' })
export class CompanionService {
  private _url = signal(read(URL_KEY));
  private _token = signal(read(TOKEN_KEY));

  url = this._url.asReadonly();
  token = this._token.asReadonly();

  configured = computed(() => !!this._url() && !!this._token());

  private _health = signal<CompanionHealth | null>(null);
  health = this._health.asReadonly();

  private _checking = signal(false);
  checking = this._checking.asReadonly();

  configure(url: string, token: string): void {
    // Trailing slashes turn every path into a double slash, which some hosts
    // answer with a redirect that drops the Authorization header.
    const cleaned = url.trim().replace(/\/+$/, '');
    this._url.set(cleaned);
    this._token.set(token.trim());
    write(URL_KEY, cleaned);
    write(TOKEN_KEY, token.trim());
    this._health.set(null);
  }

  forget(): void {
    this._url.set('');
    this._token.set('');
    write(URL_KEY, '');
    write(TOKEN_KEY, '');
    this._health.set(null);
  }

  // Asks the service what it is. `/health` needs no token, so a 401 here means
  // the address is right and the token is wrong — worth telling apart.
  async check(): Promise<CompanionHealth> {
    if (!this._url()) {
      const result = { ok: false, error: 'No address set.' };
      this._health.set(result);
      return result;
    }
    this._checking.set(true);
    try {
      const response = await fetch(`${this._url()}/health`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as CompanionHealth;
      // A service with no token configured refuses everything, so it is not
      // usable even though /health answers cheerfully.
      const result: CompanionHealth = {
        ...body,
        ok: body.ok === true,
        error: (body as { configured?: boolean }).configured === false
          ? 'The server is up but has no MUSIC_HUB_TOKEN set, so it will refuse every request.'
          : undefined,
      };
      this._health.set(result);
      return result;
    } catch (err) {
      const result = { ok: false, error: friendly(err) };
      this._health.set(result);
      return result;
    } finally {
      this._checking.set(false);
    }
  }

  // A pasted link resolves to that exact video. Searching for the id instead
  // finds whatever YouTube makes of an eleven-character string, which is
  // usually nothing.
  async info(videoId: string): Promise<YoutubeResult> {
    const response = await this.call(`/info?id=${encodeURIComponent(videoId)}`);
    return (await response.json()) as YoutubeResult;
  }

  async search(query: string): Promise<YoutubeResult[]> {
    const response = await this.call(`/search?q=${encodeURIComponent(query)}`);
    return (await response.json()) as YoutubeResult[];
  }

  async downloadAudio(videoId: string): Promise<File> {
    const response = await this.call(`/download?id=${encodeURIComponent(videoId)}`);
    const blob = await response.blob();
    if (blob.size < 10_000) throw new Error('The companion returned an empty file.');
    return new File([blob], `${videoId}.m4a`, { type: 'audio/mp4' });
  }

  private async call(path: string): Promise<Response> {
    if (!this.configured()) throw new Error('The companion is not set up.');
    let response: Response;
    try {
      response = await fetch(`${this._url()}${path}`, {
        headers: { Authorization: `Bearer ${this._token()}` },
      });
    } catch (err) {
      throw new Error(friendly(err));
    }
    if (response.ok) return response;

    // The service sends a sentence worth showing; anything else gets one.
    const detail = await response
      .json()
      .then(body => (body as { detail?: string }).detail)
      .catch(() => undefined);
    if (response.status === 401) throw new Error('The companion rejected the token.');
    throw new Error(detail || `The companion answered ${response.status}.`);
  }
}

// A failed fetch to a host that is asleep, gone, or blocked by the page's CSP
// all look identical from here, so the message covers the three.
function friendly(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return /failed to fetch|networkerror|load failed/i.test(message)
    ? 'Could not reach the companion — it may be asleep, the address may be wrong, or the site’s CSP may be blocking it.'
    : message;
}

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private mode: the setting lasts for this session only.
  }
}
