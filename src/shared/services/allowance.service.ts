import { Injectable, computed, effect, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';

/**
 * How much of the shared library one account is allowed to fill.
 *
 * Admins have no ceiling: they are the ones who decide what the 1 GB is spent
 * on. Everybody else gets a share, so that one person's discography cannot
 * quietly become the whole budget.
 *
 * This is for showing a number, not for deciding anything. The database refuses
 * an over-quota insert on its own — a trigger, not a policy, because a quota is
 * a fact about all of somebody's rows rather than about the one being written.
 */
@Injectable({ providedIn: 'root' })
export class AllowanceService {
  private _usedBytes = signal(0);
  usedBytes = this._usedBytes.asReadonly();

  private _quotaBytes = signal<number | null>(null);
  quotaBytes = this._quotaBytes.asReadonly();

  private _unlimited = signal(true);
  unlimited = this._unlimited.asReadonly();

  private _loaded = signal(false);
  loaded = this._loaded.asReadonly();

  remainingBytes = computed(() => {
    const quota = this._quotaBytes();
    if (quota === null) return null;
    return Math.max(0, quota - this._usedBytes());
  });

  usedPercent = computed(() => {
    const quota = this._quotaBytes();
    if (!quota) return 0;
    return Math.min(100, Math.round((this._usedBytes() / quota) * 100));
  });

  /** Within a hair of the ceiling, which is worth saying before an upload. */
  nearlyFull = computed(() => this.usedPercent() >= 85);

  constructor(
    private supabase: SupabaseService,
    private auth: AuthService
  ) {
    effect(() => {
      const user = this.auth.user();
      // Re-read when the role changes too: being promoted lifts the ceiling.
      this.auth.role();
      if (user) void this.load();
      else this.reset();
    });
  }

  async load(): Promise<void> {
    if (!this.auth.user()) return;
    try {
      const { data, error } = await this.supabase.client.rpc('my_upload_allowance');
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return;
      this._usedBytes.set(Number(row.used_bytes) || 0);
      this._quotaBytes.set(row.quota_bytes === null ? null : Number(row.quota_bytes));
      this._unlimited.set(row.is_unlimited === true);
      this._loaded.set(true);
    } catch {
      // Offline: whatever was last read stands. A stale number is better than
      // a zero that would read as "you have used nothing".
    }
  }

  private reset(): void {
    this._usedBytes.set(0);
    this._quotaBytes.set(null);
    this._unlimited.set(true);
    this._loaded.set(false);
  }
}
