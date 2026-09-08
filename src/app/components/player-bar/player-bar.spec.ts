import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PlayerBar } from './player-bar';
import { PlayerService } from '../../../shared/services/player.service';
import { LibraryService } from '../../../shared/services/library.service';
import { SongModel } from '../../../shared/models/song.model';

// The queue screen is the one piece of this that cannot be checked by driving
// the service alone: it has to render, and its buttons have to be wired to the
// right indices. Signing in is not possible here, so the component is rendered
// against a stubbed player instead.

function song(id: string): SongModel {
  return {
    id,
    title: `Song ${id}`,
    artist: `Artist ${id}`,
    album: 'Album',
    duration: 100,
    source: 'local',
    coverColor: '#ff9000',
    addedAt: 0,
    ownerId: '',
    sizeBytes: 1,
    syncState: 'synced',
    downloaded: true,
    hasCover: false,
  };
}

describe('PlayerBar queue screen', () => {
  const queue = [song('a'), song('b'), song('c'), song('d')];
  let calls: string[];

  function stubPlayer(volumeSupported = true) {
    return {
      queue: signal(queue).asReadonly(),
      queueIndex: signal(1).asReadonly(), // playing "b"
      current: signal(queue[1]).asReadonly(),
      isPlaying: signal(false).asReadonly(),
      currentTime: signal(12).asReadonly(),
      duration: signal(100).asReadonly(),
      progress: signal(0.12).asReadonly(),
      volume: signal(0.5).asReadonly(),
      speed: signal(1).asReadonly(),
      sleepRemainingMs: signal<number | null>(null).asReadonly(),
      sleepAtEnd: signal(false).asReadonly(),
      sleepArmed: signal(false).asReadonly(),
      shuffle: signal(false).asReadonly(),
      repeat: signal<'off' | 'all' | 'one'>('off').asReadonly(),
      upNext: signal(queue.slice(2).map((s, offset) => ({ song: s, index: 2 + offset }))).asReadonly(),
      volumeSupported,
      toggle: () => calls.push('toggle'),
      next: () => calls.push('next'),
      previous: () => calls.push('previous'),
      toggleShuffle: () => calls.push('shuffle'),
      cycleRepeat: () => calls.push('repeat'),
      seek: (t: number) => calls.push(`seek:${t}`),
      setVolume: (v: number) => calls.push(`volume:${v}`),
      cycleSpeed: () => calls.push('speed'),
      setSleepTimer: (c: number | 'end') => calls.push(`sleep:${c}`),
      clearSleepTimer: () => calls.push('sleep:off'),
      jumpTo: (i: number) => calls.push(`jump:${i}`),
      moveInQueue: (from: number, to: number) => calls.push(`move:${from}->${to}`),
      removeFromQueue: (i: number) => calls.push(`remove:${i}`),
    };
  }

  async function render(volumeSupported = true) {
    calls = [];
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PlayerBar],
      providers: [
        { provide: PlayerService, useValue: stubPlayer(volumeSupported) },
        { provide: LibraryService, useValue: { coverSrc: () => null } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PlayerBar);
    fixture.componentInstance.expanded.set(true);
    fixture.componentInstance.showQueue.set(true);
    fixture.detectChanges();
    return fixture;
  }

  it('lists what is playing and what is next', async () => {
    const fixture = await render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Playing now');
    expect(text).toContain('Song b');
    expect(text).toContain('Next up');
    expect(text).toContain('Song c');
    expect(text).toContain('Song d');
    // "a" is behind the playhead, so it is not in "up next".
    expect(text).not.toContain('Song a');
  });

  it('jumps, reorders and removes by queue index, not row number', async () => {
    const fixture = await render();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.player-queue-row:not(.is-current)'
    );
    expect(rows.length).toBe(2);

    // The second up-next row is "d", which sits at queue index 3.
    const row = rows[1];
    (row.querySelector('.player-queue-item-text') as HTMLButtonElement).click();
    const buttons = row.querySelectorAll('.player-queue-btn');
    (buttons[0] as HTMLButtonElement).click(); // up
    (buttons[2] as HTMLButtonElement).click(); // remove

    expect(calls).toEqual(['jump:3', 'move:3->2', 'remove:3']);
  });

  it('cannot move the first entry up or the last one down', async () => {
    const fixture = await render();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.player-queue-row:not(.is-current)'
    );
    const first = rows[0].querySelectorAll('.player-queue-btn');
    const last = rows[1].querySelectorAll('.player-queue-btn');

    expect((first[0] as HTMLButtonElement).disabled).toBe(true); // up on the first
    expect((first[1] as HTMLButtonElement).disabled).toBe(false);
    expect((last[1] as HTMLButtonElement).disabled).toBe(true); // down on the last
  });

  it('shows the volume slider where volume can be set', async () => {
    const fixture = await render(true);
    const slider = (fixture.nativeElement as HTMLElement).querySelector(
      '.player-full-volume input[type="range"]'
    ) as HTMLInputElement;
    expect(slider).toBeTruthy();
    expect(slider.value).toBe('0.5');

    slider.value = '0.8';
    slider.dispatchEvent(new Event('input'));
    expect(calls).toContain('volume:0.8');
  });

  it('hides it where the platform ignores it', async () => {
    const fixture = await render(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('.player-full-volume')).toBeNull();
  });
});

// A swipe and a tap arrive as the same click, and a scroll arrives as the same
// touch. Telling them apart is the whole of this feature, so it is driven
// directly rather than through the DOM, which cannot fake a real finger.

function swipe(
  panel: { onTouchStart(e: TouchEvent): void; onTouchEnd(e: TouchEvent, from: 'mini' | 'full'): void },
  from: 'mini' | 'full',
  dx: number,
  dy: number
): void {
  const at = (x: number, y: number) =>
    ({ changedTouches: [{ clientX: x, clientY: y }] }) as unknown as TouchEvent;
  panel.onTouchStart(at(150, 300));
  panel.onTouchEnd(at(150 + dx, 300 + dy), from);
}

describe('PlayerBar swipe', () => {
  let calls: string[];
  let panel: PlayerBar;

  beforeEach(async () => {
    calls = [];
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PlayerBar],
      providers: [
        {
          provide: PlayerService,
          useValue: {
            queue: signal([]).asReadonly(),
            queueIndex: signal(-1).asReadonly(),
            current: signal(null).asReadonly(),
            isPlaying: signal(false).asReadonly(),
            currentTime: signal(0).asReadonly(),
            duration: signal(0).asReadonly(),
            progress: signal(0).asReadonly(),
            volume: signal(1).asReadonly(),
            speed: signal(1).asReadonly(),
            shuffle: signal(false).asReadonly(),
            repeat: signal<'off' | 'all' | 'one'>('off').asReadonly(),
            upNext: signal([]).asReadonly(),
            sleepRemainingMs: signal<number | null>(null).asReadonly(),
            sleepAtEnd: signal(false).asReadonly(),
            sleepArmed: signal(false).asReadonly(),
            volumeSupported: true,
            next: () => calls.push('next'),
            previous: () => calls.push('previous'),
          },
        },
        { provide: LibraryService, useValue: { coverSrc: () => null } },
      ],
    }).compileComponents();
    panel = TestBed.createComponent(PlayerBar).componentInstance;
  });

  it('changes song sideways and opens the player upward', () => {
    swipe(panel, 'mini', -80, 4);
    expect(calls).toEqual(['next']);

    swipe(panel, 'mini', 80, -6);
    expect(calls).toEqual(['next', 'previous']);

    swipe(panel, 'mini', 3, -70);
    expect(panel.expanded()).toBe(true);
  });

  it('closes the full player downward, and never the other way round', () => {
    panel.expanded.set(true);
    // Down on the mini player is nothing: there is nowhere further to go.
    swipe(panel, 'mini', 0, 90);
    expect(panel.expanded()).toBe(true);

    swipe(panel, 'full', 0, 90);
    expect(panel.expanded()).toBe(false);
  });

  it('ignores a short move, and a diagonal that is really a scroll', () => {
    swipe(panel, 'mini', -20, 0);
    swipe(panel, 'mini', -50, -48);
    expect(calls).toEqual([]);
    expect(panel.expanded()).toBe(false);
  });

  it('eats the click a swipe leaves behind', () => {
    swipe(panel, 'mini', -80, 0);
    // Without this, the swipe would change song *and* open the full player.
    panel.onMiniClick();
    expect(panel.expanded()).toBe(false);

    // The next real tap still works.
    panel.onMiniClick();
    expect(panel.expanded()).toBe(true);
  });
});
