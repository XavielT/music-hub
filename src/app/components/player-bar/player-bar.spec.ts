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
