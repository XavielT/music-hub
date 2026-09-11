// Metadata for a pasted link — and nothing else.
//
// SCOPE GUARD, deliberate and load-bearing: this function returns titles,
// artists, album names, years, durations and a cover *image* URL. It never
// returns, resolves, proxies or looks for audio. Spotify does not expose track
// audio at all (it is DRM'd), and YouTube audio extraction is off the table for
// this project by decision — see the round's triage notes. If a future change
// here starts reaching for a media URL, that is the bug.
//
// The point of it being a function rather than a fetch from the app is the
// Spotify client secret, which cannot ship in an Angular bundle, plus CORS:
// neither Spotify's API nor YouTube's thumbnail host answers a browser from
// this origin.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SPOTIFY_ID = Deno.env.get('SPOTIFY_CLIENT_ID') ?? '';
const SPOTIFY_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET') ?? '';

const SITE_URL = 'https://music-hub-xaviel.vercel.app';
const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://localhost', // the Capacitor WebView's origin on Android
  'http://localhost:4200',
  'http://localhost:8100',
];

function cors(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : SITE_URL;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  });
}

// --- rate limit ---------------------------------------------------------
// Per-user, in memory. An instance is short-lived and there may be several, so
// this is a brake rather than a guarantee — enough to stop a loop in the app
// from hammering Spotify on somebody's behalf, which is all it is for.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, number[]>();

function overLimit(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter(at => now - at < WINDOW_MS);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > MAX_PER_WINDOW;
}

// --- spotify ------------------------------------------------------------
// The client-credentials token is good for an hour. Kept on the instance so a
// burst of pastes costs one token request rather than one each.
let token: { value: string; expiresAt: number } | null = null;

async function spotifyToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 30_000) return token.value;
  if (!SPOTIFY_ID || !SPOTIFY_SECRET) {
    throw new Error('Spotify links need SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to be set.');
  }
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${SPOTIFY_ID}:${SPOTIFY_SECRET}`)}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(`Spotify refused the credentials (${response.status}).`);
  const body = (await response.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

async function spotify(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.spotify.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${await spotifyToken()}` },
  });
  if (response.status === 404) throw new Error('Spotify does not know that link.');
  if (!response.ok) throw new Error(`Spotify answered ${response.status}.`);
  return (await response.json()) as Record<string, unknown>;
}

interface SpotifyImage {
  url: string;
  width: number;
}
interface SpotifyArtist {
  name: string;
}
interface SpotifyAlbum {
  name?: string;
  release_date?: string;
  images?: SpotifyImage[];
}
interface SpotifyTrack {
  name?: string;
  artists?: SpotifyArtist[];
  album?: SpotifyAlbum;
  duration_ms?: number;
}

// The biggest image Spotify offers is 640px, which is already more than the
// app stores after shrinking — take the widest and let the client scale it.
function biggest(images: SpotifyImage[] | undefined): string | null {
  if (!images?.length) return null;
  return [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;
}

function artistsOf(artists: SpotifyArtist[] | undefined): string {
  return (artists ?? []).map(a => a.name).filter(Boolean).join(', ');
}

function yearOf(date: string | undefined): number | null {
  const year = Number((date ?? '').slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : null;
}

function trackFrom(track: SpotifyTrack, album?: SpotifyAlbum) {
  const on = track.album ?? album;
  return {
    title: track.name ?? '',
    artist: artistsOf(track.artists),
    album: on?.name ?? '',
    year: yearOf(on?.release_date),
    durationSeconds: track.duration_ms ? Math.round(track.duration_ms / 1000) : 0,
    coverUrl: biggest(on?.images),
  };
}

// --- link parsing -------------------------------------------------------

interface SpotifyRef {
  kind: 'track' | 'album' | 'playlist';
  id: string;
}

function spotifyRef(raw: string): SpotifyRef | null {
  const uri = /^spotify:(track|album|playlist):([A-Za-z0-9]+)/.exec(raw.trim());
  if (uri) return { kind: uri[1] as SpotifyRef['kind'], id: uri[2] };
  try {
    const url = new URL(raw);
    if (!/(^|\.)spotify\.com$/.test(url.hostname)) return null;
    // Paths carry a locale segment sometimes: /intl-es/track/<id>
    const match = /\/(track|album|playlist)\/([A-Za-z0-9]+)/.exec(url.pathname);
    return match ? { kind: match[1] as SpotifyRef['kind'], id: match[2] } : null;
  } catch {
    return null;
  }
}

function isSpotifyShortLink(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.hostname === 'spotify.link' || url.hostname === 'spoti.fi';
  } catch {
    return false;
  }
}

// A share link from the phone app is a redirect to the real one. Followed with
// the response discarded — only the final URL is wanted.
async function resolveShortLink(raw: string): Promise<string> {
  try {
    const response = await fetch(raw, { redirect: 'follow' });
    return response.url || raw;
  } catch {
    return raw;
  }
}

function youtubeId(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
    const v = url.searchParams.get('v');
    if (v) return v;
    const embed = /\/(embed|shorts|live)\/([A-Za-z0-9_-]+)/.exec(url.pathname);
    return embed ? embed[2] : null;
  } catch {
    return null;
  }
}

// YouTube titles are written by uploaders, not by a database. "Artist - Title"
// is the convention often enough to be worth splitting on, and the channel name
// is the fallback when it is not followed. Everything here is a guess and the
// user sees it before it is applied.
const SEPARATORS = [' - ', ' – ', ' — ', ' | ', ' · '];

function splitYoutubeTitle(raw: string, author: string): { title: string; artist: string } {
  // Strip the decorations uploaders add: "(Official Video)", "[HD]", "| Lyrics"
  const cleaned = raw
    .replace(/\((?:[^()]*?(?:official|video|audio|lyric|lyrics|hd|4k|mv|visualizer)[^()]*?)\)/gi, '')
    .replace(/\[(?:[^\[\]]*?(?:official|video|audio|lyric|lyrics|hd|4k|mv|visualizer)[^\[\]]*?)\]/gi, '')
    .trim();

  for (const separator of SEPARATORS) {
    const at = cleaned.indexOf(separator);
    if (at > 0) {
      const left = cleaned.slice(0, at).trim();
      const right = cleaned.slice(at + separator.length).trim();
      if (left && right) return { artist: left, title: right };
    }
  }
  // Channels are often "Someone - Topic" on auto-generated music uploads.
  return { title: cleaned || raw, artist: author.replace(/\s*-\s*Topic$/i, '').trim() };
}

async function youtubeMetadata(id: string) {
  const oembed =
    `https://www.youtube.com/oembed?format=json&url=` +
    encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
  const response = await fetch(oembed);
  if (!response.ok) throw new Error('YouTube does not know that link.');
  const body = (await response.json()) as { title?: string; author_name?: string };
  const split = splitYoutubeTitle(body.title ?? '', body.author_name ?? '');
  return {
    provider: 'youtube',
    tracks: [
      {
        ...split,
        album: '',
        year: null,
        durationSeconds: 0,
        // maxres is not generated for every video; hqdefault always exists.
        coverUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      },
    ],
  };
}

// --- cover proxy --------------------------------------------------------
// The app cannot fetch these hosts itself (no CORS headers for this origin),
// and it needs the bytes, not a URL, to store the cover offline. Only image
// responses are passed through, and only from the two hosts that can appear in
// our own answers — an open proxy would be a gift to somebody else.
const IMAGE_HOSTS = [/(^|\.)scdn\.co$/, /(^|\.)spotifycdn\.com$/, /(^|\.)ytimg\.com$/];

async function coverBytes(raw: string, origin: string | null): Promise<Response> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return json({ error: 'That is not a URL.' }, 400, origin);
  }
  if (url.protocol !== 'https:' || !IMAGE_HOSTS.some(host => host.test(url.hostname))) {
    return json({ error: 'That image is not from a host this function serves.' }, 400, origin);
  }
  const response = await fetch(url.toString());
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.startsWith('image/')) {
    return json({ error: 'That cover could not be fetched.' }, 502, origin);
  }
  return new Response(response.body, {
    status: 200,
    headers: {
      ...cors(origin),
      'Content-Type': type,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

// --- entry point --------------------------------------------------------

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405, origin);

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Sign in first.' }, 401, origin);

  // Any signed-in account may use this, listeners included: it reads public
  // metadata and writes nothing.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Sign in first.' }, 401, origin);

  if (overLimit(userData.user.id)) {
    return json({ error: 'Too many links at once — wait a minute.' }, 429, origin);
  }

  let body: { url?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400, origin);
  }

  const url = String(body.url ?? '').trim();
  if (!url) return json({ error: 'Paste a link first.' }, 400, origin);
  if (body.action === 'cover') return await coverBytes(url, origin);

  try {
    const resolved = isSpotifyShortLink(url) ? await resolveShortLink(url) : url;

    const ref = spotifyRef(resolved);
    if (ref) {
      if (ref.kind === 'track') {
        const track = (await spotify(`tracks/${ref.id}`)) as SpotifyTrack;
        return json({ provider: 'spotify', tracks: [trackFrom(track)] }, 200, origin);
      }
      if (ref.kind === 'album') {
        const album = (await spotify(`albums/${ref.id}`)) as SpotifyAlbum & {
          tracks?: { items?: SpotifyTrack[] };
        };
        const items = album.tracks?.items ?? [];
        return json(
          { provider: 'spotify', album: album.name ?? '', tracks: items.map(t => trackFrom(t, album)) },
          200,
          origin
        );
      }
      const playlist = (await spotify(`playlists/${ref.id}`)) as {
        name?: string;
        tracks?: { items?: { track?: SpotifyTrack | null }[] };
      };
      const tracks = (playlist.tracks?.items ?? [])
        .map(item => item.track)
        .filter((t): t is SpotifyTrack => !!t)
        .map(t => trackFrom(t));
      return json({ provider: 'spotify', album: playlist.name ?? '', tracks }, 200, origin);
    }

    const video = youtubeId(resolved);
    if (video) return json(await youtubeMetadata(video), 200, origin);

    return json({ error: 'That is not a Spotify or YouTube link.' }, 400, origin);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 502, origin);
  }
});
