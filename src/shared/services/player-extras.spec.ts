import { DbService } from './db.service';
import { PLAYBACK_SPEEDS, PlayerService } from './player.service';
import { SongModel } from '../models/song.model';

// Speed and the sleep timer are both "settings that outlive a song", and both
// have a way of quietly not applying: the element resets playbackRate on every
// new source, and a countdown in a backgrounded WebView stops counting.

const USER = 'extras-spec-user';
const DB_NAME = `music-hub-db::${USER}`;
const SPEED_KEY = 'music-hub.speed';

function song(id: string): SongModel {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Artist',
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

function drop(name: string): Promise<void> {
  return new Promise(resolve => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

describe('Playback speed and the sleep timer', () => {
  let player: PlayerService;
  let db: DbService;
  let songs: SongModel[];
  let messages: string[];
  let signed: string[];

  async function build(list: SongModel[]): Promise<void> {
    songs = list;
    messages = [];
    signed = [];
    db = new DbService();
    await db.use(USER);
    player = new PlayerService(
      db,
      {
        songs: () => songs,
        whenReady: async () => undefined,
        coverSrc: () => null,
        getSongFile: async (id: string) =>
          songs.find(s => s.id === id)?.downloaded ? new Blob(['audio']) : undefined,
      } as never,
      {
        getStreamUrl: async (song: SongModel) => {
          signed.push(song.id);
          return 'https://example.test/stream';
        },
      } as never,
      { error: (t: string) => messages.push(t), show: (t: string) => messages.push(t) } as never
    );
  }

  // A song that streams: no local copy, but an object in the bucket.
  function streamed(id: string): SongModel {
    return { ...song(id), downloaded: false, storagePath: `owner/${id}.mp3` };
  }

  // The element behind the service, for checking what actually reached it.
  function element(): HTMLAudioElement {
    return (player as unknown as { audio: HTMLAudioElement }).audio;
  }

  beforeEach(async () => {
    localStorage.removeItem('music-hub.player-prefs');
    localStorage.removeItem(SPEED_KEY);
    await drop(DB_NAME);
  });

  afterEach(async () => {
    player?.stop();
    localStorage.removeItem(SPEED_KEY);
    await drop(DB_NAME);
  });

  describe('speed', () => {
    it('cycles through the offered speeds and wraps', async () => {
      await build([song('a')]);
      expect(player.speed()).toBe(1);

      for (const expected of [...PLAYBACK_SPEEDS.slice(2), ...PLAYBACK_SPEEDS.slice(0, 2)]) {
        player.cycleSpeed();
        expect(player.speed()).toBe(expected);
      }
    });

    it('reaches the audio element, and survives changing song', async () => {
      const list = [song('a'), song('b')];
      await build(list);
      await player.play(list[0], list);

      player.setSpeed(1.5);
      expect(element().playbackRate).toBe(1.5);

      // A new source resets the rate unless it is re-applied per song, which
      // is the bug this is here to catch.
      await player.next();
      expect(player.current()?.id).toBe('b');
      expect(element().playbackRate).toBe(1.5);
    });

    it('is remembered for the next time the app opens', async () => {
      await build([song('a')]);
      player.setSpeed(1.25);

      player.stop();
      await build([song('a')]);
      expect(player.speed()).toBe(1.25);
      expect(element().playbackRate).toBe(1.25);
    });

    it('refuses a speed no browser would accept', async () => {
      await build([song('a')]);
      player.setSpeed(99);
      expect(player.speed()).toBe(4);
      player.setSpeed(0);
      expect(player.speed()).toBe(0.25);
    });
  });

  describe('warming the next song', () => {
    it('signs the next streamed song while this one is still playing', async () => {
      const list = [streamed('a'), streamed('b'), streamed('c')];
      await build(list);
      await player.play(list[0], list);
      await new Promise(r => setTimeout(r, 10));

      // "a" because it is playing, "b" because it is next — and not "c".
      expect(signed).toEqual(['a', 'b']);
    });

    it('does not sign a song that is already on the device', async () => {
      const list = [streamed('a'), song('b')];
      await build(list);
      await player.play(list[0], list);
      await new Promise(r => setTimeout(r, 10));

      expect(signed).toEqual(['a']);
    });

    it('leaves the last song alone unless the queue wraps', async () => {
      const list = [streamed('a'), streamed('b')];
      await build(list);
      await player.play(list[1], list); // starting on the last one
      await new Promise(r => setTimeout(r, 10));
      expect(signed).toEqual(['b']);

      // With repeat on, the song after the last one is the first one.
      player.cycleRepeat(); // off -> all
      await player.jumpTo(1);
      await new Promise(r => setTimeout(r, 10));
      expect(signed).toContain('a');
    });
  });

  describe('sleep timer', () => {
    it('counts down from a deadline rather than by ticking', async () => {
      jasmine.clock().install();
      const base = Date.now();
      jasmine.clock().mockDate(new Date(base));
      await build([song('a')]);

      player.setSleepTimer(30);
      expect(player.sleepArmed()).toBe(true);
      expect(player.sleepRemainingMs()).toBe(30 * 60_000);

      // A backgrounded WebView stops firing intervals. Time still passed, so
      // one late tick has to settle the whole debt, not one second of it.
      jasmine.clock().mockDate(new Date(base + 29 * 60_000));
      jasmine.clock().tick(1000);
      expect(Math.round((player.sleepRemainingMs() ?? 0) / 60_000)).toBe(1);

      jasmine.clock().mockDate(new Date(base + 31 * 60_000));
      jasmine.clock().tick(1000);
      expect(player.sleepArmed()).toBe(false);
      expect(player.sleepRemainingMs()).toBeNull();
      jasmine.clock().uninstall();
    });

    it('pauses rather than stopping, so the morning is one tap away', async () => {
      jasmine.clock().install();
      const base = Date.now();
      jasmine.clock().mockDate(new Date(base));
      const list = [song('a'), song('b')];
      await build(list);
      await player.play(list[0], list);

      player.setSleepTimer(15);
      jasmine.clock().mockDate(new Date(base + 16 * 60_000));
      jasmine.clock().tick(1000);

      expect(player.isPlaying()).toBe(false);
      // The queue and the song it was on are untouched.
      expect(player.current()?.id).toBe('a');
      expect(player.queue().length).toBe(2);
      expect(messages.some(m => m.includes('Sleep timer'))).toBe(true);
      jasmine.clock().uninstall();
    });

    it('stops at the end of the song instead of moving on', async () => {
      const list = [song('a'), song('b')];
      await build(list);
      await player.play(list[0], list);

      player.setSleepTimer('end');
      expect(player.sleepAtEnd()).toBe(true);

      element().dispatchEvent(new Event('ended'));
      await new Promise(r => setTimeout(r, 10));

      // Still on the first song: the queue did not advance.
      expect(player.current()?.id).toBe('a');
      expect(player.sleepArmed()).toBe(false);
    });

    it('outranks repeat-one, which would otherwise never reach an end', async () => {
      const list = [song('a')];
      await build(list);
      await player.play(list[0], list);
      player.cycleRepeat(); // off -> all
      player.cycleRepeat(); // all -> one
      expect(player.repeat()).toBe('one');

      player.setSleepTimer('end');
      element().dispatchEvent(new Event('ended'));
      await new Promise(r => setTimeout(r, 10));

      expect(player.isPlaying()).toBe(false);
      expect(player.sleepArmed()).toBe(false);
    });

    it('replaces one choice with the other rather than running both', async () => {
      await build([song('a')]);
      player.setSleepTimer(30);
      player.setSleepTimer('end');

      expect(player.sleepAtEnd()).toBe(true);
      expect(player.sleepRemainingMs()).toBeNull();

      player.clearSleepTimer();
      expect(player.sleepArmed()).toBe(false);
    });

    it('does not outlive the account', async () => {
      await build([song('a')]);
      player.setSleepTimer(30);
      player.stop();
      expect(player.sleepArmed()).toBe(false);
    });
  });
});
