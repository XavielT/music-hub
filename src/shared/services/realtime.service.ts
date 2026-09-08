import { Injectable, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

export type LiveStatus = 'off' | 'connecting' | 'live' | 'error';

// A burst of changes — an admin adding an album, a playlist rebuilt song by
// song — should cost one reconciliation, not twenty. Long enough to coalesce a
// burst, short enough that a single change still feels immediate.
const COALESCE_MS = 750;

// Reconnect backoff. The channel usually recovers on its own; this covers the
// cases where the socket comes back but the join does not.
const RETRY_MS = [2000, 5000, 15000, 30000];

// The three tables a device has to hear about. `songs` is the shared library,
// the other two are this user's own playlists.
const WATCHED_TABLES = ['songs', 'playlists', 'playlist_songs'] as const;

// Listens for changes to the library in Postgres and asks for a reconciliation
// when one lands.
//
// Deliberately, it does not apply the payloads. SyncService already merges
// cloud state into the local library correctly — keeping edits made offline,
// keeping downloads, keeping a song that is only on this device — and a second
// merge path written against single-row events would be a second place for all
// of that to go wrong. So an event here means only "something upstream is
// different", and the reconciliation that already exists decides what that
// means. It costs three small selects on a library that is capped at 1 GB.
//
// It also makes the events safe to take at face value. Postgres ships only the
// primary key for a DELETE, so Realtime cannot check it against a policy and
// sends it to every subscriber; treated as data that would leak, treated as a
// signal it resolves to a sync that returns the same rows as before.
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private _status = signal<LiveStatus>('off');
  status = this._status.asReadonly();

  private channel: RealtimeChannel | null = null;
  private onChange: (() => void) | null = null;
  private coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  // Set once the channel has been up: a later re-join means events were missed
  // while it was down, so it owes a reconciliation rather than just a status.
  private wasLive = false;

  constructor(private supabase: SupabaseService) {
    // Android freezes the WebView in the background and the socket goes with
    // it. Coming back is the moment to check the channel is still joined and
    // to catch up on whatever happened while the phone was in a pocket.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !this.onChange) return;
      if (this.channel?.state === 'joined') this.requestSync();
      else this.resubscribe();
    });
  }

  // Starts listening for this account. `onChange` is called after a change
  // lands upstream, debounced.
  start(onChange: () => void): void {
    this.stop();
    this.onChange = onChange;
    this.subscribe();
  }

  // Signing out, or switching account: the channel carries the old user's
  // token and their rows.
  stop(): void {
    this.clearTimers();
    this.onChange = null;
    this.retryAttempt = 0;
    this.wasLive = false;
    const channel = this.channel;
    this.channel = null;
    if (channel) void this.supabase.client.removeChannel(channel);
    this._status.set('off');
  }

  private subscribe(): void {
    if (!this.onChange) return;
    this._status.set('connecting');

    const channel = this.supabase.client.channel('library-changes');
    for (const table of WATCHED_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () =>
        this.requestSync()
      );
    }

    channel.subscribe(status => {
      if (!this.onChange) return;
      if (status === 'SUBSCRIBED') {
        this.retryAttempt = 0;
        this._status.set('live');
        // Anything that changed while the channel was down was never
        // announced, so a fresh join owes one reconciliation.
        if (this.wasLive) this.requestSync();
        this.wasLive = true;
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this._status.set('error');
        this.scheduleRetry();
      }
    });

    this.channel = channel;
  }

  private resubscribe(): void {
    if (!this.onChange) return;
    // A retry already on the clock would otherwise throw away the channel this
    // is about to open, and start the cycle again.
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const channel = this.channel;
    this.channel = null;
    if (channel) void this.supabase.client.removeChannel(channel);
    this.subscribe();
  }

  private scheduleRetry(): void {
    if (this.retryTimer || !this.onChange) return;
    const delay = RETRY_MS[Math.min(this.retryAttempt, RETRY_MS.length - 1)];
    this.retryAttempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.resubscribe();
    }, delay);
  }

  private requestSync(): void {
    if (this.coalesceTimer) clearTimeout(this.coalesceTimer);
    this.coalesceTimer = setTimeout(() => {
      this.coalesceTimer = null;
      this.onChange?.();
    }, COALESCE_MS);
  }

  private clearTimers(): void {
    if (this.coalesceTimer) clearTimeout(this.coalesceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.coalesceTimer = null;
    this.retryTimer = null;
  }
}
