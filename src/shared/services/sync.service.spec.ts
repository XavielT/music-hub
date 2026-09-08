import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from './auth.service';
import { CloudLibraryService } from './cloud-library.service';
import { LibraryService } from './library.service';
import { PlayerService } from './player.service';
import { RealtimeService } from './realtime.service';
import { SyncService } from './sync.service';
import { ToastService } from './toast.service';

// Live sync turns SyncService into something that runs while the user is doing
// other things, which puts weight on two behaviours that did not matter when a
// sync was only ever a button press: a change that lands mid-sync must not be
// lost, and a background pull must not talk to the user.

const USER = { id: 'user-1' };

describe('SyncService with live updates', () => {
  let listSongsCalls: number;
  let gated: boolean;
  let releaseList: (() => void) | null;
  let failWith: Error | null;
  let toasts: string[];
  let realtimeCallback: (() => void) | null;
  let realtimeStops: number;
  let sync: SyncService;

  function build(): SyncService {
    listSongsCalls = 0;
    gated = false;
    releaseList = null;
    failWith = null;
    toasts = [];
    realtimeCallback = null;
    realtimeStops = 0;

    const cloud = {
      listSongs: async () => {
        listSongsCalls++;
        // A test can hold the first pull open to create the mid-sync window.
        if (gated) {
          gated = false;
          await new Promise<void>(resolve => (releaseList = resolve));
        }
        if (failWith) throw failWith;
        return [];
      },
      listPlaylists: async () => [],
      listPlaylistSongs: async () => [],
      resetSession: () => undefined,
    };

    const library = {
      whenReady: async () => undefined,
      activate: async () => undefined,
      deactivate: () => undefined,
      applyRow: async () => undefined,
      applyPlaylistRow: async () => undefined,
      buildSongIds: () => [],
      dropSyncedSongsMissingFrom: async () => undefined,
      dropSyncedPlaylistsMissingFrom: async () => undefined,
      pushDirtySongs: async () => undefined,
      songs: signal([]).asReadonly(),
      playlists: signal([]).asReadonly(),
      localOnlySongs: signal([]).asReadonly(),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SyncService,
        { provide: AuthService, useValue: { user: signal(USER).asReadonly() } },
        { provide: CloudLibraryService, useValue: cloud },
        { provide: LibraryService, useValue: library },
        { provide: PlayerService, useValue: { stop: () => undefined, restoreSession: async () => undefined } },
        {
          provide: RealtimeService,
          useValue: {
            start: (onChange: () => void) => (realtimeCallback = onChange),
            stop: () => realtimeStops++,
          },
        },
        {
          provide: ToastService,
          useValue: { error: (m: string) => toasts.push(m), show: (m: string) => toasts.push(m) },
        },
      ],
    });
    return TestBed.inject(SyncService);
  }

  beforeEach(() => (sync = build()));

  // Holds the next pull open and hands back the release.
  function gate(): () => void {
    gated = true;
    return () => releaseList?.();
  }

  // Signing in is an effect, and it pulls once on its own. Every test wants to
  // start after that has happened rather than race it.
  async function signedIn(): Promise<void> {
    TestBed.flushEffects();
    for (let i = 0; i < 60 && !realtimeCallback; i++) await new Promise(r => setTimeout(r, 5));
    for (let i = 0; i < 60 && sync.syncing(); i++) await new Promise(r => setTimeout(r, 5));
    listSongsCalls = 0;
    toasts = [];
  }

  it('runs a second pass for a change that arrives mid-sync', async () => {
    await signedIn();
    const release = gate();
    const first = sync.sync();
    await Promise.resolve();
    expect(sync.syncing()).toBe(true);

    // Two events land while the first pull is still open. Both are covered by
    // one more pass — not two, and not none.
    await sync.sync({ silent: true });
    await sync.sync({ silent: true });
    expect(listSongsCalls).toBe(1);

    release();
    await first;
    // The queued pass runs on its own; let it finish.
    for (let i = 0; i < 40 && sync.syncing(); i++) await new Promise(r => setTimeout(r, 5));

    expect(listSongsCalls).toBe(2);
    expect(sync.syncing()).toBe(false);
  });

  it('says nothing when a background sync fails', async () => {
    await signedIn();
    failWith = new Error('Failed to fetch');
    await sync.sync({ silent: true });
    expect(toasts).toEqual([]);

    // The same failure, when the user pressed the button, is worth reporting.
    await sync.sync();
    expect(toasts.length).toBe(1);
    expect(toasts[0]).toContain('No connection');
  });

  it('starts live updates for the account and reconciles when one arrives', async () => {
    await signedIn();
    expect(realtimeCallback).withContext('live updates were never started').toBeTruthy();

    const before = listSongsCalls;
    realtimeCallback!();
    for (let i = 0; i < 20 && listSongsCalls === before; i++) await new Promise(r => setTimeout(r, 5));
    expect(listSongsCalls).toBe(before + 1);
    // A change somebody else made is not an event the user needs told about.
    expect(toasts).toEqual([]);
  });

  it('drops the channel when the account closes', () => {
    // closeAccount runs for the signed-out case; the effect drives it, but the
    // contract worth pinning is that stopping the account stops the channel.
    (sync as unknown as { closeAccount(): void }).closeAccount();
    expect(realtimeStops).toBe(1);
  });
});
