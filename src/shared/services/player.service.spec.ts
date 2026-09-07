import { DbService } from './db.service';
import { PlayerService, shuffleKeepingFirst } from './player.service';
import { SongModel } from '../models/song.model';

// Queue behaviour is the part of this app with the most invisible state:
// a shuffled order, an original order to get back to, an index into whichever
// is live, and a persisted copy of all three. These pin the acceptance
// criteria down.

const USER = 'player-spec-user';
const DB_NAME = `music-hub-db::${USER}`;

function song(id: string, playable = true): SongModel {
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
    // Unplayable = nothing to resolve: no local blob, no cloud object, no url.
    downloaded: playable,
    hasCover: false,
  };
}

function drop(name: string): Promise<void> {
  return new Promise(resolve => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

describe('shuffleKeepingFirst', () => {
  it('pins the chosen item first and keeps every other one', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = shuffleKeepingFirst(items, 3);
    expect(shuffled[0]).toBe(4);
    expect(shuffled.length).toBe(items.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  it('copes with an empty list and an out-of-range index', () => {
    expect(shuffleKeepingFirst([], 0)).toEqual([]);
    expect(shuffleKeepingFirst([1, 2], 9).sort()).toEqual([1, 2]);
  });
});

describe('PlayerService', () => {
  let player: PlayerService;
  let db: DbService;
  let songs: SongModel[];
  let errors: string[];

  // `cloudReachable: false` stands in for being offline: the song has a cloud
  // object, but no signed URL can be got for it right now.
  async function build(list: SongModel[], cloudReachable = true): Promise<void> {
    songs = list;
    errors = [];
    db = new DbService();
    await db.use(USER);
    player = new PlayerService(
      db,
      {
        songs: () => songs,
        whenReady: async () => undefined,
        coverSrc: () => null,
        // A "downloaded" song has bytes; anything else has none.
        getSongFile: async (id: string) =>
          songs.find(s => s.id === id)?.downloaded ? new Blob(['audio']) : undefined,
      } as never,
      {
        getStreamUrl: async () => {
          if (!cloudReachable) throw new Error('offline');
          return 'https://example.test/stream';
        },
      } as never,
      { error: (text: string) => errors.push(text), show: () => undefined } as never
    );
  }

  beforeEach(async () => {
    localStorage.removeItem('music-hub.player-prefs');
    localStorage.removeItem('music-hub.volume');
    await drop(DB_NAME);
  });

  afterEach(async () => {
    player?.stop();
    await drop(DB_NAME);
  });

  const ids = () => player.queue().map(s => s.id);

  describe('shuffle', () => {
    it('keeps the current song playing and restores the order when turned off', async () => {
      const list = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => song(id));
      await build(list);
      await player.play(list[2], list); // playing "c"

      player.setShuffle(true);
      expect(player.current()?.id).toBe('c');
      expect(player.queue()[player.queueIndex()].id).toBe('c');
      expect(ids().sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);

      player.setShuffle(false);
      expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
      // Still the same song, now back at its original position.
      expect(player.current()?.id).toBe('c');
      expect(player.queueIndex()).toBe(2);
    });

    it('never loses the queue however many times it is toggled', async () => {
      const list = ['a', 'b', 'c', 'd'].map(id => song(id));
      await build(list);
      await player.play(list[0], list);

      for (let i = 0; i < 6; i++) player.toggleShuffle();

      expect(ids().sort()).toEqual(['a', 'b', 'c', 'd']);
      expect(player.queue().length).toBe(4);
    });

    it('carries songs queued while shuffled back into the plain order', async () => {
      const list = ['a', 'b', 'c'].map(id => song(id));
      await build(list);
      await player.play(list[0], list);
      player.setShuffle(true);

      player.addToQueue(song('z'));
      player.setShuffle(false);

      expect(ids()).toContain('z');
      expect(ids().length).toBe(4);
    });
  });

  describe('repeat', () => {
    it('stops on the last song when off', async () => {
      const list = ['a', 'b'].map(id => song(id));
      await build(list);
      await player.play(list[1], list); // already last
      expect(player.queueIndex()).toBe(1);

      await player.next(true); // as if the song ended

      expect(player.queueIndex()).toBe(1);
      expect(player.isPlaying()).toBe(false);
    });

    it('wraps to the start when set to all', async () => {
      const list = ['a', 'b'].map(id => song(id));
      await build(list);
      await player.play(list[1], list);
      player.cycleRepeat(); // off -> all

      await player.next(true);

      expect(player.queueIndex()).toBe(0);
      expect(player.current()?.id).toBe('a');
    });

    it('stays on the song when set to one, but a manual next still moves', async () => {
      const list = ['a', 'b'].map(id => song(id));
      await build(list);
      await player.play(list[0], list);
      player.cycleRepeat();
      player.cycleRepeat(); // off -> all -> one

      await player.next(true);
      expect(player.current()?.id).toBe('a');

      await player.next(); // a tap on the button
      expect(player.current()?.id).toBe('b');
    });
  });

  describe('queue editing', () => {
    it('puts playNext straight after the current song and addToQueue at the end', async () => {
      const list = ['a', 'b', 'c'].map(id => song(id));
      await build(list);
      await player.play(list[0], list);

      player.playNext(song('n'));
      player.addToQueue(song('z'));

      expect(ids()).toEqual(['a', 'n', 'b', 'c', 'z']);
    });

    it('keeps playing the same song when the queue is reordered around it', async () => {
      const list = ['a', 'b', 'c', 'd'].map(id => song(id));
      await build(list);
      await player.play(list[1], list); // playing "b"

      player.moveInQueue(3, 0); // d to the front

      expect(ids()).toEqual(['d', 'a', 'b', 'c']);
      expect(player.current()?.id).toBe('b');
      expect(player.queue()[player.queueIndex()].id).toBe('b');
    });

    it('shifts the index when something before the current song is removed', async () => {
      const list = ['a', 'b', 'c'].map(id => song(id));
      await build(list);
      await player.play(list[2], list);
      expect(player.queueIndex()).toBe(2);

      await player.removeFromQueue(0);

      expect(ids()).toEqual(['b', 'c']);
      expect(player.current()?.id).toBe('c');
      expect(player.queueIndex()).toBe(1);
    });

    it('moves on to the next song when the one playing is removed', async () => {
      const list = ['a', 'b', 'c'].map(id => song(id));
      await build(list);
      await player.play(list[1], list);

      await player.removeFromQueue(1);

      expect(ids()).toEqual(['a', 'c']);
      expect(player.current()?.id).toBe('c');
    });

    it('jumps to any entry', async () => {
      const list = ['a', 'b', 'c'].map(id => song(id));
      await build(list);
      await player.play(list[0], list);

      await player.jumpTo(2);

      expect(player.current()?.id).toBe('c');
      expect(player.queueIndex()).toBe(2);
    });
  });

  describe('unplayable songs', () => {
    it('skips past what cannot play and keeps going', async () => {
      // The airplane-mode case: downloaded songs interleaved with cloud-only
      // ones that cannot be fetched.
      const list = [song('a'), song('bad', false), song('bad2', false), song('d')];
      list[1].storagePath = 'someone/bad.mp3';
      list[2].storagePath = 'someone/bad2.mp3';
      await build(list, false);
      await player.play(list[0], list);

      await player.next(true);

      // Landed on "d", stepping over both unplayable songs.
      expect(player.current()?.id).toBe('d');
      expect(player.queueIndex()).toBe(3);
      expect(errors).toEqual([]);
    });

    it('gives up once, not once per song, when nothing can play', async () => {
      const list = ['a', 'b', 'c', 'd'].map(id => song(id, false));
      await build(list);

      await player.play(list[0], list);

      expect(player.isPlaying()).toBe(false);
      // The whole point of B4: one message, however long the queue is.
      expect(errors.length).toBe(1);
    });

    it('names the song when it is the only one asked for', async () => {
      const only = song('solo', false);
      only.storagePath = 'someone/solo.mp3';
      await build([only], false);

      await player.play(only);

      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('"Song solo"');
    });
  });

  describe('resuming', () => {
    it('comes back to the same song and position, paused', async () => {
      const list = ['a', 'b', 'c'].map(id => song(id));
      await build(list);
      await player.play(list[1], list);
      player.seek(42);
      player.cycleRepeat(); // off -> all
      await player.jumpTo(2);
      player.seek(17);
      await (player as never as { saveSession(): Promise<void> }).saveSession();

      // A new session on the same database, as after reopening the app.
      const revived = new PlayerService(
        db,
        {
          songs: () => songs,
          whenReady: async () => undefined,
          coverSrc: () => null,
          getSongFile: async () => new Blob(['audio']),
        } as never,
        { getStreamUrl: async () => 'https://example.test/stream' } as never,
        { error: () => undefined, show: () => undefined } as never
      );
      await revived.restoreSession();

      expect(revived.current()?.id).toBe('c');
      expect(revived.queueIndex()).toBe(2);
      expect(revived.queue().map(s => s.id)).toEqual(['a', 'b', 'c']);
      expect(revived.repeat()).toBe('all');
      expect(revived.currentTime()).toBe(17);
      // Never autoplay.
      expect(revived.isPlaying()).toBe(false);
      revived.stop();
    });

    it('drops songs that no longer exist rather than restoring a broken queue', async () => {
      const list = ['a', 'b', 'c'].map(id => song(id));
      await build(list);
      await player.play(list[0], list);
      await (player as never as { saveSession(): Promise<void> }).saveSession();

      // "b" was deleted while the app was closed.
      songs = list.filter(s => s.id !== 'b');
      const revived = new PlayerService(
        db,
        {
          songs: () => songs,
          whenReady: async () => undefined,
          coverSrc: () => null,
          getSongFile: async () => new Blob(['audio']),
        } as never,
        { getStreamUrl: async () => 'https://example.test/stream' } as never,
        { error: () => undefined, show: () => undefined } as never
      );
      await revived.restoreSession();

      expect(revived.queue().map(s => s.id)).toEqual(['a', 'c']);
      revived.stop();
    });
  });

  describe('volume', () => {
    it('clamps and remembers the level', async () => {
      await build([song('a')]);
      player.setVolume(0.4);
      expect(player.volume()).toBe(0.4);
      player.setVolume(5);
      expect(player.volume()).toBe(1);
      player.setVolume(-2);
      expect(player.volume()).toBe(0);
      expect(localStorage.getItem('music-hub.volume')).toBe('0');
    });
  });
});
