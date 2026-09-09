import { Injectable, computed, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { CompanionService } from './companion.service';
import { LibraryService } from './library.service';
import { ToastService } from './toast.service';
import { YoutubeResult } from './youtube.service';
import { DownloadRequestRow, isActive, requestLabel } from '../models/download-request.model';

// Backstop for the live channel. A phone that was asleep, a socket that came
// back without re-joining — the queue should still drain, just later.
const POLL_MS = 45_000;

// Matches the cap in the insert policy. Checked here only so the message says
// what happened instead of "row-level security".
export const MAX_ACTIVE_PER_MEMBER = 10;

const COLUMNS =
  'id, requested_by, video_id, title, artist, thumbnail, duration, status, claimed_by, claimed_at, song_id, error, created_at, updated_at';

/**
 * Songs members have asked for, and the loop that fetches them.
 *
 * A member cannot add to the shared library — `songs` is admin-only in the
 * database — and on an iPhone or in the browser there is no companion to
 * download with either. So instead of a download they queue a request, and an
 * admin device with a working companion picks it up and does it for them. The
 * song lands in the shared library, which is where they were going to play it
 * from anyway.
 *
 * The worker runs in the app, so requests are fulfilled while Music Hub is
 * open on the admin's phone rather than merely while that phone is on. It
 * claims through a `security definer` function that hands one row to one
 * worker, so two admin devices open at once cannot download the same song
 * twice.
 */
@Injectable({ providedIn: 'root' })
export class DownloadQueueService {
  private _requests = signal<DownloadRequestRow[]>([]);
  requests = this._requests.asReadonly();

  private _loading = signal(false);
  loading = this._loading.asReadonly();

  private _busy = signal(false);
  busy = this._busy.asReadonly();

  // The video id this device is downloading right now, for the spinner.
  private _fulfilling = signal<string | null>(null);
  fulfilling = this._fulfilling.asReadonly();

  // This device can actually do the work: an admin (so it may write to the
  // shared library) with a companion (so it can get the audio).
  canFulfil = computed(() => this.auth.isAdmin() && this.companion.configured());

  mine = computed(() => {
    const me = this.auth.user()?.id;
    return me ? this._requests().filter(r => r.requested_by === me) : [];
  });

  active = computed(() => this._requests().filter(isActive));
  myActive = computed(() => this.mine().filter(isActive));

  private channel: RealtimeChannel | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private started = false;

  constructor(
    private supabase: SupabaseService,
    private auth: AuthService,
    private companion: CompanionService,
    private library: LibraryService,
    private toast: ToastService
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.load().then(() => this.kick());

    const channel = this.supabase.client.channel('download-queue');
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'download_requests' },
      () => void this.load().then(() => this.kick())
    );
    channel.subscribe();
    this.channel = channel;

    this.poll = setInterval(() => void this.load().then(() => this.kick()), POLL_MS);
  }

  stop(): void {
    this.started = false;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    const channel = this.channel;
    this.channel = null;
    if (channel) void this.supabase.client.removeChannel(channel);
    this._requests.set([]);
  }

  async load(): Promise<void> {
    if (!this.auth.user()) return;
    this._loading.set(true);
    try {
      const { data, error } = await this.supabase.client
        .from('download_requests')
        .select(COLUMNS)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      this._requests.set((data ?? []) as DownloadRequestRow[]);
    } catch (err) {
      // The queue is a side panel, not the app. A failed refresh leaves the
      // last list on screen rather than interrupting anyone.
      console.warn('loading the download queue failed', err);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Queue a song. `video` may be nothing but an id — a member with no way to
   * search YouTube can still paste a link, and the worker fills in the rest.
   */
  async request(video: { id: string; title?: string; author?: string; duration?: number; thumbnail?: string }): Promise<boolean> {
    const me = this.auth.user()?.id;
    if (!me) return false;
    this._busy.set(true);
    try {
      const { error } = await this.supabase.client.from('download_requests').insert({
        requested_by: me,
        video_id: video.id,
        title: video.title?.trim() ?? '',
        artist: video.author?.trim() ?? '',
        thumbnail: video.thumbnail ?? null,
        duration: Math.round(video.duration ?? 0),
      });
      if (error) throw error;
      await this.load();
      this.toast.show('Asked for that song — it will appear in the library once it is fetched.');
      this.kick();
      return true;
    } catch (err) {
      this.toast.error(this.friendly(err));
      return false;
    } finally {
      this._busy.set(false);
    }
  }

  async cancel(id: string): Promise<void> {
    this._busy.set(true);
    try {
      const { error } = await this.supabase.client.from('download_requests').delete().eq('id', id);
      if (error) throw new Error(error.message);
      await this.load();
    } catch (err) {
      this.toast.error(this.friendly(err));
    } finally {
      this._busy.set(false);
    }
  }

  // Start the worker if this device is one and it is not already running.
  kick(): void {
    if (this.canFulfil()) void this.drain();
  }

  /**
   * Claim and fulfil requests until the queue is empty.
   *
   * Reload before finishing: the last claim's own update arrives on the live
   * channel too, but a worker that just wrote the row should not have to wait
   * for a round trip to show it.
   */
  private async drain(): Promise<void> {
    if (this.draining || !this.canFulfil()) return;
    this.draining = true;
    try {
      for (;;) {
        const request = await this.claim();
        if (!request) break;
        await this.fulfil(request);
      }
    } catch (err) {
      console.warn('draining the download queue failed', err);
    } finally {
      this.draining = false;
      this._fulfilling.set(null);
      await this.load();
    }
  }

  private async claim(): Promise<DownloadRequestRow | null> {
    const { data, error } = await this.supabase.client.rpc('claim_download_request');
    if (error) throw new Error(error.message);
    // The function returns a null row when there is nothing to do, which comes
    // back as an object of nulls rather than as null itself.
    const row = data as DownloadRequestRow | null;
    return row?.id ? row : null;
  }

  private async fulfil(request: DownloadRequestRow): Promise<void> {
    this._fulfilling.set(request.video_id);
    let title = request.title.trim();
    let artist = request.artist.trim();
    let thumbnail = request.thumbnail ?? undefined;
    let duration = request.duration;

    try {
      // A request made from a pasted link carries no metadata, so ask the
      // companion before downloading. Best effort: a song with a video id for
      // a title is better than no song.
      if (!title) {
        try {
          const info = await this.companion.info(request.video_id);
          title = info.title;
          artist = info.author;
          thumbnail = info.thumbnail ?? thumbnail;
          duration = info.duration || duration;
        } catch (err) {
          console.warn('could not look up requested video', request.video_id, err);
        }
      }

      const file = await this.companion.downloadAudio(request.video_id);
      const song = await this.library.addLocalSong(file, {
        title: title || request.video_id,
        artist: artist || 'Unknown artist',
        album: 'YouTube',
        coverUrl: thumbnail,
        duration,
      });

      // Uploaded explicitly rather than through addLocalSong's flag, because
      // whether it reached the cloud decides what this request becomes: the
      // point of the request was a song everyone can play, and a song that is
      // only on this device is not that.
      const uploaded = await this.library.uploadSong(song);
      if (!uploaded) {
        await this.finish(request.id, {
          status: 'failed',
          error: 'Downloaded, but it could not be uploaded to the shared library.',
          title,
          artist,
        });
        return;
      }

      await this.finish(request.id, { status: 'done', song_id: song.id, title, artist });
      this.toast.show(`Fetched "${title || request.video_id}" for the library ✔`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.finish(request.id, { status: 'failed', error: message.slice(0, 300), title, artist });
    }
  }

  private async finish(id: string, patch: Partial<DownloadRequestRow>): Promise<void> {
    const { error } = await this.supabase.client
      .from('download_requests')
      .update(patch)
      .eq('id', id);
    // Losing the bookkeeping is not worth failing the download that already
    // succeeded; the stale-claim reclaim in the database covers it.
    if (error) console.warn('could not update download request', id, error.message);
  }

  label = requestLabel;

  private friendly(err: unknown): string {
    const code = (err as { code?: string })?.code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === '23505' || /duplicate key/i.test(message)) {
      return 'That song is already in the queue.';
    }
    if (code === '42501' || /row-level security/i.test(message)) {
      return `You already have ${MAX_ACTIVE_PER_MEMBER} songs waiting — let those finish first.`;
    }
    return /failed to fetch|networkerror|load failed/i.test(message)
      ? 'No connection — try again in a moment.'
      : message;
  }
}
