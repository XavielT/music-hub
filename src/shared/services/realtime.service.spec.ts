import { RealtimeService } from './realtime.service';

// The value of this service is entirely in when it calls back and when it does
// not: one reconciliation for a burst rather than twenty, one after a re-join
// because events were missed while the socket was down, and none at all once
// the account is gone. None of that is visible from the outside, so it is
// driven here against a fake channel.

type Handler = () => void;
type SubscribeCallback = (status: string) => void;

class FakeChannel {
  handlers: { table: string; fire: Handler }[] = [];
  subscribeCallback: SubscribeCallback | null = null;
  state = 'closed';

  on(_type: string, filter: { table: string }, fire: Handler): this {
    this.handlers.push({ table: filter.table, fire });
    return this;
  }

  subscribe(callback: SubscribeCallback): this {
    this.subscribeCallback = callback;
    return this;
  }

  // What the socket does, from the test's point of view.
  join(): void {
    this.state = 'joined';
    this.subscribeCallback?.('SUBSCRIBED');
  }

  fail(status = 'CHANNEL_ERROR'): void {
    this.state = 'errored';
    this.subscribeCallback?.(status);
  }

  emit(table: string): void {
    for (const handler of this.handlers) if (handler.table === table) handler.fire();
  }
}

describe('RealtimeService', () => {
  let channels: FakeChannel[];
  let removed: FakeChannel[];
  let service: RealtimeService;
  let syncs: number;

  beforeEach(() => {
    jasmine.clock().install();
    channels = [];
    removed = [];
    syncs = 0;
    service = new RealtimeService({
      client: {
        channel: () => {
          const channel = new FakeChannel();
          channels.push(channel);
          return channel;
        },
        removeChannel: (channel: FakeChannel) => {
          removed.push(channel);
          return Promise.resolve('ok');
        },
      },
    } as never);
  });

  afterEach(() => {
    service.stop();
    jasmine.clock().uninstall();
  });

  function start(): FakeChannel {
    service.start(() => syncs++);
    return channels[channels.length - 1];
  }

  it('watches the three library tables and reports being live', () => {
    const channel = start();
    expect(service.status()).toBe('connecting');
    expect(channel.handlers.map(h => h.table).sort()).toEqual([
      'playlist_songs',
      'playlists',
      'songs',
    ]);

    channel.join();
    expect(service.status()).toBe('live');
    // Joining for the first time is not news: the caller has just synced.
    jasmine.clock().tick(5000);
    expect(syncs).toBe(0);
  });

  it('collapses a burst of changes into one reconciliation', () => {
    const channel = start();
    channel.join();

    for (let i = 0; i < 20; i++) channel.emit('songs');
    channel.emit('playlists');
    channel.emit('playlist_songs');

    // Still inside the coalescing window — nothing has fired yet.
    jasmine.clock().tick(700);
    expect(syncs).toBe(0);

    jasmine.clock().tick(100);
    expect(syncs).toBe(1);
  });

  it('reconciles again for a change that lands after the first one', () => {
    const channel = start();
    channel.join();

    channel.emit('songs');
    jasmine.clock().tick(800);
    channel.emit('songs');
    jasmine.clock().tick(800);

    expect(syncs).toBe(2);
  });

  it('retries a failed channel and reconciles once it is back', () => {
    const first = start();
    first.fail();
    expect(service.status()).toBe('error');

    // Nothing happens before the backoff is up.
    jasmine.clock().tick(1500);
    expect(channels.length).toBe(1);

    jasmine.clock().tick(1000);
    expect(channels.length).toBe(2);
    expect(removed).toContain(first);
  });

  it('reconciles after a re-join, because events were missed while it was down', () => {
    const first = start();
    first.join();
    expect(syncs).toBe(0);

    first.fail();
    jasmine.clock().tick(2000);
    const second = channels[1];
    second.join();

    jasmine.clock().tick(800);
    expect(syncs).toBe(1);
  });

  it('stops calling back once the account is gone', () => {
    const channel = start();
    channel.join();
    channel.emit('songs');

    service.stop();
    expect(service.status()).toBe('off');
    expect(removed).toContain(channel);

    // The event that was waiting out its window must not survive the account.
    jasmine.clock().tick(5000);
    expect(syncs).toBe(0);

    // Nor may a channel that fails after the fact schedule a retry.
    channel.fail();
    jasmine.clock().tick(60000);
    expect(channels.length).toBe(1);
  });

  it('starting again replaces the previous channel', () => {
    const first = start();
    first.join();
    const second = start();

    expect(removed).toContain(first);
    expect(second).not.toBe(first);
    second.join();
    second.emit('songs');
    jasmine.clock().tick(800);
    expect(syncs).toBe(1);
  });
});
