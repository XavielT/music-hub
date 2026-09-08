import { CompanionService } from './companion.service';

// This service is the app's only door to a machine on the internet, so what it
// does with a bad answer matters more than what it does with a good one: a
// sleeping free-tier container, a wrong token and a CSP block all arrive as
// the same failed fetch, and the message has to be worth reading.

const URL_KEY = 'music-hub.companion-url';
const TOKEN_KEY = 'music-hub.companion-token';

describe('CompanionService', () => {
  let service: CompanionService;
  let requests: { url: string; auth: string | null }[];
  let respond: () => Response | Promise<Response>;
  let realFetch: typeof fetch;

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  beforeEach(() => {
    localStorage.removeItem(URL_KEY);
    localStorage.removeItem(TOKEN_KEY);
    requests = [];
    respond = () => json({ ok: true, ytdlp: '2026.08.19', configured: true, cookies: false });

    realFetch = window.fetch;
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({ url: String(input), auth: headers.get('Authorization') });
      return Promise.resolve(respond());
    }) as typeof fetch;

    service = new CompanionService();
  });

  afterEach(() => {
    window.fetch = realFetch;
    localStorage.removeItem(URL_KEY);
    localStorage.removeItem(TOKEN_KEY);
  });

  it('is not configured until it has both halves', () => {
    expect(service.configured()).toBe(false);
    service.configure('https://companion.test', '');
    expect(service.configured()).toBe(false);
    service.configure('https://companion.test', 'secret');
    expect(service.configured()).toBe(true);
  });

  it('strips a trailing slash, which would double every path', async () => {
    service.configure('https://companion.test/', 'secret');
    await service.search('anything');
    expect(requests[0].url).toBe('https://companion.test/search?q=anything');
  });

  it('remembers the setup on the next launch, per device', () => {
    service.configure('https://companion.test', 'secret');
    // A second instance is what happens after a reload.
    const reopened = new CompanionService();
    expect(reopened.configured()).toBe(true);
    expect(reopened.url()).toBe('https://companion.test');
  });

  it('forgets both halves', () => {
    service.configure('https://companion.test', 'secret');
    service.forget();
    expect(service.configured()).toBe(false);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('sends the token as a bearer', async () => {
    service.configure('https://companion.test', 'secret');
    await service.search('kevin macleod');
    expect(requests[0].auth).toBe('Bearer secret');
    expect(requests[0].url).toContain('q=kevin%20macleod');
  });

  it('calls a server that is up but unconfigured what it is', async () => {
    service.configure('https://companion.test', 'secret');
    respond = () => json({ ok: true, configured: false });

    const health = await service.check();
    // /health answers cheerfully; it would still refuse every real request.
    expect(health.error).toContain('MUSIC_HUB_TOKEN');
  });

  it('reports a reachable server with its yt-dlp version', async () => {
    service.configure('https://companion.test', 'secret');
    const health = await service.check();
    expect(health.ok).toBe(true);
    expect(health.error).toBeUndefined();
    expect(health.ytdlp).toBe('2026.08.19');
    // /health takes no token — a 401 there would mean something else.
    expect(requests[0].auth).toBeNull();
  });

  it('turns an unreachable host into one sentence covering the three causes', async () => {
    service.configure('https://companion.test', 'secret');
    respond = () => {
      throw new TypeError('Failed to fetch');
    };

    const health = await service.check();
    expect(health.ok).toBe(false);
    expect(health.error).toContain('asleep');
    expect(health.error).toContain('CSP');
  });

  it('names a rejected token rather than passing on a 401', async () => {
    service.configure('https://companion.test', 'wrong');
    respond = () => json({ detail: 'Bad or missing token.' }, 401);

    await expectAsync(service.search('x')).toBeRejectedWithError(/rejected the token/);
  });

  it('passes the server’s own sentence through when it has one', async () => {
    service.configure('https://companion.test', 'secret');
    respond = () => json({ detail: 'That is 90 minutes long; the limit is 30.' }, 413);

    await expectAsync(service.downloadAudio('abcdefghijk')).toBeRejectedWithError(/90 minutes/);
  });

  it('refuses a suspiciously small download rather than saving silence', async () => {
    service.configure('https://companion.test', 'secret');
    respond = () => new Response(new Blob(['tiny']), { status: 200 });

    await expectAsync(service.downloadAudio('abcdefghijk')).toBeRejectedWithError(/empty file/);
  });

  it('returns a named m4a the library can take', async () => {
    service.configure('https://companion.test', 'secret');
    respond = () =>
      new Response(new Blob([new Uint8Array(20_000)], { type: 'audio/mp4' }), { status: 200 });

    const file = await service.downloadAudio('abcdefghijk');
    expect(file.name).toBe('abcdefghijk.m4a');
    expect(file.type).toBe('audio/mp4');
    expect(file.size).toBe(20_000);
  });

  it('will not call out at all before it is set up', async () => {
    await expectAsync(service.search('x')).toBeRejectedWithError(/not set up/);
    expect(requests).toEqual([]);
  });
});
