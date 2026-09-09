import { signal } from '@angular/core';
import { DownloadQueueService } from './download-queue.service';
import { DownloadRequestRow, isActive, requestLabel } from '../models/download-request.model';

// The worker is the part with teeth: it claims rows other devices can also see,
// downloads real files, and writes to a shared library. What it does when a
// step fails decides whether a request is lost, retried forever, or quietly
// marked done with no song behind it.

function row(over: Partial<DownloadRequestRow> = {}): DownloadRequestRow {
  return {
    id: 'req-1',
    requested_by: 'friend',
    video_id: 'vid00000001',
    title: 'A Song',
    artist: 'An Artist',
    thumbnail: 'https://img/1.jpg',
    duration: 200,
    status: 'pending',
    claimed_by: null,
    claimed_at: null,
    song_id: null,
    error: null,
    created_at: '2026-09-09T00:00:00Z',
    updated_at: '2026-09-09T00:00:00Z',
    ...over,
  };
}

describe('DownloadQueueService', () => {
  let service: DownloadQueueService;

  let isAdmin: ReturnType<typeof signal<boolean>>;
  let configured: ReturnType<typeof signal<boolean>>;

  let listed: DownloadRequestRow[];
  let claims: (DownloadRequestRow | null)[];
  let inserted: Record<string, unknown>[];
  let updates: { id: string; patch: Record<string, unknown> }[];
  let deleted: string[];
  let insertError: { code?: string; message: string } | null;

  let downloads: string[];
  let infoCalls: string[];
  let downloadFails: string | null;
  let uploadResult: boolean;
  let added: { title: string; artist: string; coverUrl?: string; duration?: number }[];

  let toasts: string[];
  let errors: string[];

  // Enough of the postgrest builder for the four shapes the service uses.
  function table(name: string) {
    let mode = '';
    let patch: Record<string, unknown> = {};
    let id = '';
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      insert: (values: Record<string, unknown>) => {
        mode = 'insert';
        inserted.push(values);
        return builder;
      },
      update: (values: Record<string, unknown>) => {
        mode = 'update';
        patch = values;
        return builder;
      },
      delete: () => {
        mode = 'delete';
        return builder;
      },
      eq: (_column: string, value: string) => {
        id = value;
        return builder;
      },
      then: (resolve: (r: unknown) => void) => {
        if (mode === 'insert') return resolve({ data: null, error: insertError });
        if (mode === 'update') {
          updates.push({ id, patch });
          return resolve({ data: null, error: null });
        }
        if (mode === 'delete') {
          deleted.push(id);
          return resolve({ data: null, error: null });
        }
        return resolve({ data: name === 'download_requests' ? listed : [], error: null });
      },
    };
    return builder;
  }

  beforeEach(() => {
    isAdmin = signal(true);
    configured = signal(true);
    listed = [];
    claims = [];
    inserted = [];
    updates = [];
    deleted = [];
    insertError = null;
    downloads = [];
    infoCalls = [];
    downloadFails = null;
    uploadResult = true;
    added = [];
    toasts = [];
    errors = [];

    service = new DownloadQueueService(
      {
        client: {
          from: (name: string) => table(name),
          rpc: async (fn: string) => {
            if (fn !== 'claim_download_request') throw new Error(`unexpected rpc ${fn}`);
            // Postgres hands back a row of nulls, not null, when a function
            // returning a composite type finds nothing.
            const next = claims.shift() ?? null;
            return { data: next ?? { id: null, video_id: null }, error: null };
          },
          channel: () => ({ on: () => ({ subscribe: () => undefined }), subscribe: () => undefined }),
          removeChannel: () => undefined,
        },
      } as never,
      { isAdmin, user: () => ({ id: 'me' }) } as never,
      {
        configured,
        info: async (videoId: string) => {
          infoCalls.push(videoId);
          return { id: videoId, title: 'Looked Up', author: 'Found Artist', duration: 321, thumbnail: 'https://img/x.jpg' };
        },
        downloadAudio: async (videoId: string) => {
          downloads.push(videoId);
          if (downloadFails) throw new Error(downloadFails);
          return new File([new Uint8Array(20_000)], `${videoId}.m4a`, { type: 'audio/mp4' });
        },
      } as never,
      {
        addLocalSong: async (_file: File, meta: { title: string; artist: string; coverUrl?: string; duration?: number }) => {
          added.push(meta);
          return { id: 'song-1', title: meta.title };
        },
        uploadSong: async () => uploadResult,
      } as never,
      { show: (m: string) => toasts.push(m), error: (m: string) => errors.push(m) } as never
    );
  });

  describe('who does the work', () => {
    it('will not fetch without a companion, however admin the account is', () => {
      configured.set(false);
      expect(service.canFulfil()).toBe(false);
    });

    it('will not fetch as a member, however configured the companion is', () => {
      isAdmin.set(false);
      expect(service.canFulfil()).toBe(false);
    });

    it('does nothing when kicked on a device that cannot fetch', async () => {
      configured.set(false);
      service.kick();
      await Promise.resolve();
      expect(downloads).toEqual([]);
    });
  });

  describe('draining the queue', () => {
    it('downloads, uploads, and marks the request done against the new song', async () => {
      claims = [row()];
      service.kick();
      await settle();

      expect(downloads).toEqual(['vid00000001']);
      expect(added[0].title).toBe('A Song');
      const done = updates.find(u => u.patch['status'] === 'done');
      expect(done?.patch['song_id']).toBe('song-1');
    });

    it('keeps claiming until the queue is empty', async () => {
      claims = [row({ id: 'a', video_id: 'vid00000001' }), row({ id: 'b', video_id: 'vid00000002' })];
      service.kick();
      await settle();

      expect(downloads).toEqual(['vid00000001', 'vid00000002']);
    });

    // The empty-queue answer is a row of nulls. Read as a real request it
    // would be claimed and downloaded forever.
    it('treats a row of nulls as an empty queue', async () => {
      claims = [];
      service.kick();
      await settle();

      expect(downloads).toEqual([]);
      expect(updates).toEqual([]);
    });

    it('looks the video up when the request arrived as a bare link', async () => {
      claims = [row({ title: '', artist: '', thumbnail: null, duration: 0 })];
      service.kick();
      await settle();

      expect(infoCalls).toEqual(['vid00000001']);
      expect(added[0].title).toBe('Looked Up');
      expect(added[0].artist).toBe('Found Artist');
    });

    it('still downloads when the lookup fails, using the video id as a name', async () => {
      claims = [row({ title: '', artist: '' })];
      service['companion'].info = () => Promise.reject(new Error('no answer'));
      service.kick();
      await settle();

      expect(downloads).toEqual(['vid00000001']);
      expect(added[0].title).toBe('vid00000001');
    });

    it('marks a failed download failed, with the reason', async () => {
      claims = [row()];
      downloadFails = 'That is 45 minutes long; the limit is 30.';
      service.kick();
      await settle();

      const failed = updates.find(u => u.patch['status'] === 'failed');
      expect(failed?.patch['error']).toContain('45 minutes');
    });

    // A song only on the fetching phone is not what was asked for: the request
    // was for something everyone can play.
    it('does not call a request done when the upload did not happen', async () => {
      claims = [row()];
      uploadResult = false;
      service.kick();
      await settle();

      expect(updates.some(u => u.patch['status'] === 'done')).toBe(false);
      const failed = updates.find(u => u.patch['status'] === 'failed');
      expect(String(failed?.patch['error'])).toContain('shared library');
    });

    it('carries on with the next request after one fails', async () => {
      claims = [row({ id: 'a', video_id: 'vid00000001' }), row({ id: 'b', video_id: 'vid00000002' })];
      let first = true;
      service['companion'].downloadAudio = (videoId: string) => {
        downloads.push(videoId);
        if (first) {
          first = false;
          return Promise.reject(new Error('boom'));
        }
        return Promise.resolve(new File([new Uint8Array(20_000)], 'x.m4a'));
      };
      service.kick();
      await settle();

      expect(downloads).toEqual(['vid00000001', 'vid00000002']);
      expect(updates.filter(u => u.patch['status'] === 'done').length).toBe(1);
    });
  });

  describe('asking for a song', () => {
    it('sends the id with whatever metadata it has', async () => {
      await service.request({ id: 'vid00000009', title: ' Padded ', author: 'Someone', duration: 200.6 });

      expect(inserted[0]).toEqual(
        jasmine.objectContaining({ video_id: 'vid00000009', title: 'Padded', artist: 'Someone', duration: 201 })
      );
    });

    it('accepts a bare id, leaving the metadata for the worker', async () => {
      await service.request({ id: 'vid00000009' });

      expect(inserted[0]).toEqual(jasmine.objectContaining({ title: '', artist: '', thumbnail: null }));
    });

    it('says a song is already queued rather than showing a unique violation', async () => {
      insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
      const ok = await service.request({ id: 'vid00000009' });

      expect(ok).toBe(false);
      expect(errors[0]).toContain('already in the queue');
    });

    it('explains the cap rather than showing a policy violation', async () => {
      insertError = { code: '42501', message: 'new row violates row-level security policy' };
      await service.request({ id: 'vid00000009' });

      expect(errors[0]).toContain('10 songs waiting');
    });

    it('cancels a request by id', async () => {
      await service.cancel('req-7');
      expect(deleted).toEqual(['req-7']);
    });
  });

  describe('what the list means', () => {
    it('counts only unfinished requests as active', () => {
      expect(isActive(row({ status: 'pending' }))).toBe(true);
      expect(isActive(row({ status: 'working' }))).toBe(true);
      expect(isActive(row({ status: 'done' }))).toBe(false);
      expect(isActive(row({ status: 'failed' }))).toBe(false);
    });

    it('names a request that has no title after its link', () => {
      expect(requestLabel(row({ title: '   ' }))).toBe('youtube.com/watch?v=vid00000001');
      expect(requestLabel(row({ title: 'Real Title' }))).toBe('Real Title');
    });

    it('separates this member’s requests from everyone else’s', async () => {
      listed = [row({ id: 'a', requested_by: 'me' }), row({ id: 'b', requested_by: 'friend' })];
      await service.load();

      expect(service.requests().length).toBe(2);
      expect(service.mine().map(r => r.id)).toEqual(['a']);
    });
  });
});

// The worker chains several awaits per request; a couple of microtask flushes
// are not enough to see the end of a two-request drain.
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 50; i++) await Promise.resolve();
}
