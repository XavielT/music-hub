import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

// Defaults used until the table answers, and if it never does. They match the
// seeded rows, so an offline start behaves like an online one.
export const DEFAULT_MAX_UPLOAD_MB = 60;
export const DEFAULT_LANGUAGE = 'es';

const CACHE_KEY = 'music-hub.app-settings';

/**
 * Settings the admin sets once and every device reads.
 *
 * Readable by any signed-in member, writable only by admins — enforced by RLS,
 * not by hiding the form. Cached in localStorage because these are read on the
 * upload path and at first start, and neither should wait for a round trip or
 * break without a network.
 */
@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  private _maxUploadMb = signal(DEFAULT_MAX_UPLOAD_MB);
  maxUploadMb = this._maxUploadMb.asReadonly();

  private _defaultLanguage = signal(DEFAULT_LANGUAGE);
  defaultLanguage = this._defaultLanguage.asReadonly();

  private _saving = signal(false);
  saving = this._saving.asReadonly();

  constructor(private supabase: SupabaseService) {
    this.readCache();
  }

  maxUploadBytes(): number {
    return this._maxUploadMb() * 1024 * 1024;
  }

  async load(): Promise<void> {
    try {
      const { data, error } = await this.supabase.client.from('app_settings').select('key, value');
      if (error || !data) return;
      for (const row of data as { key: string; value: unknown }[]) {
        if (row.key === 'max_upload_mb') this._maxUploadMb.set(toNumber(row.value, DEFAULT_MAX_UPLOAD_MB));
        if (row.key === 'default_language') this._defaultLanguage.set(toText(row.value, DEFAULT_LANGUAGE));
      }
      this.writeCache();
    } catch {
      // Offline, or a disabled account reading zero rows: the cached values
      // stand. Nothing here is worth interrupting anyone over.
    }
  }

  /** Admin-only in the database; a refusal comes back as an error to show. */
  async save(key: 'max_upload_mb' | 'default_language', value: number | string): Promise<string | null> {
    this._saving.set(true);
    try {
      const { error } = await this.supabase.client
        .from('app_settings')
        .upsert({ key, value: value as never }, { onConflict: 'key' });
      if (error) return error.message;
      if (key === 'max_upload_mb') this._maxUploadMb.set(Number(value));
      else this._defaultLanguage.set(String(value));
      this.writeCache();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    } finally {
      this._saving.set(false);
    }
  }

  private readCache(): void {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as { maxUploadMb?: number; defaultLanguage?: string };
      if (cached.maxUploadMb) this._maxUploadMb.set(cached.maxUploadMb);
      if (cached.defaultLanguage) this._defaultLanguage.set(cached.defaultLanguage);
    } catch {
      // Private mode, or something else wrote nonsense there: use the defaults.
    }
  }

  private writeCache(): void {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ maxUploadMb: this._maxUploadMb(), defaultLanguage: this._defaultLanguage() })
      );
    } catch {
      // Nothing to do: the values still hold for this session.
    }
  }
}

// jsonb comes back already parsed, but a number may arrive as a string
// depending on how it was written.
function toNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
