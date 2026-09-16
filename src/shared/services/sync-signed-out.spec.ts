import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from './auth.service';
import { CloudLibraryService } from './cloud-library.service';
import { LibraryService } from './library.service';
import { PlayerService } from './player.service';
import { RealtimeService } from './realtime.service';
import { DownloadQueueService } from './download-queue.service';
import { AppSettingsService } from './app-settings.service';
import { SyncService } from './sync.service';
import { ToastService } from './toast.service';
import { I18nService } from './i18n.service';

// The signed-out path, which is what a first-time visitor gets and what nobody
// was testing: every other spec here starts with a user.
//
// SyncService turns the account over from an effect. On the signed-out path
// that effect calls closeAccount() unconditionally — there is no
// lastSyncedUserId guard to stop at, the way there is once a user exists — so
// anything closeAccount() touches runs on every pass. An effect re-runs when a
// signal it *read* changes, and it tracks reads made anywhere it reaches, not
// only the one it meant to watch. LibraryService.deactivate() read _coverUrls
// and then set it to a fresh {}, which is never Object.is-equal to the last
// one: the effect woke itself, cleared again, and spun the main thread
// allocating empty objects. iOS Safari killed the tab in about four seconds
// and showed "A problem repeatedly occurred"; every fresh visitor hit it, while
// an already-signed-in install did not, which is what made it look like a
// deploy problem rather than a loop.
//
// The fake library below reproduces exactly that shape — read a signal, write a
// new identity — so the test fails if the untracked() boundary in SyncService
// is ever removed.

const RUNAWAY = 20;

describe('SyncService signed out', () => {
  let deactivateCalls: number;
  let covers: ReturnType<typeof signal<Record<string, string>>>;

  function build(): SyncService {
    deactivateCalls = 0;
    covers = signal<Record<string, string>>({ 'song-1': 'blob:one' });

    const library = {
      whenReady: async () => undefined,
      activate: async () => undefined,
      // The old deactivate(), on purpose: reads the signal, then writes an
      // object that can never compare equal to what was there.
      deactivate: () => {
        deactivateCalls++;
        Object.values(covers());
        // Left unbounded, a tracked read above would wake the effect that
        // called this, for ever, and the run would end as a browser timeout
        // rather than as a number anybody can read. Stopping the write once
        // it is plainly looping turns that into a plain failed expectation.
        if (deactivateCalls <= RUNAWAY) covers.set({});
      },
      applyRow: async () => undefined,
      applyPlaylistRow: async () => undefined,
      buildSongIds: () => [],
      dropSyncedSongsMissingFrom: async () => undefined,
      dropSyncedPlaylistsMissingFrom: async () => undefined,
      pushDirtySongs: async () => undefined,
      setPeople: () => undefined,
      isMine: () => true,
      songs: signal([]).asReadonly(),
      playlists: signal([]).asReadonly(),
      localOnlySongs: signal([]).asReadonly(),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SyncService,
        // Nobody is signed in, and nobody ever has been.
        { provide: AuthService, useValue: { user: signal(null).asReadonly() } },
        { provide: LibraryService, useValue: library },
        {
          provide: CloudLibraryService,
          useValue: {
            listSongs: async () => [],
            listPlaylists: async () => [],
            listPlaylistSongs: async () => [],
            listProfiles: async () => [],
            resetSession: () => undefined,
          },
        },
        { provide: PlayerService, useValue: { stop: () => undefined, restoreSession: async () => undefined } },
        { provide: RealtimeService, useValue: { start: () => undefined, stop: () => undefined } },
        { provide: DownloadQueueService, useValue: { start: () => undefined, stop: () => undefined } },
        { provide: AppSettingsService, useValue: { load: async () => undefined } },
        { provide: ToastService, useValue: { error: () => undefined, show: () => undefined } },
      ],
    });
    return TestBed.inject(SyncService);
  }

  it('tears the account down once, however the teardown touches signals', () => {
    build();

    // The first flush constructs nothing new; it runs the effect once.
    TestBed.flushEffects();
    expect(deactivateCalls).toBe(1);

    // The teardown has now written _coverUrls. If that write were tracked, the
    // effect would be pending again and this flush would run it a second time —
    // and so would the next, without end. This is the assertion that fails if
    // untracked() goes away.
    TestBed.flushEffects();
    TestBed.flushEffects();
    expect(deactivateCalls).toBe(1);
  });
});
