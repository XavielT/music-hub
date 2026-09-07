import { Injectable } from '@angular/core';

// The iTunes Search API is free, needs no key and sends
// `access-control-allow-origin: *`, so it works from the browser as well as
// the native app. Apple asks for roughly 20 calls a minute, which is what the
// throttle below is for.
const SEARCH_ENDPOINT = 'https://itunes.apple.com/search';
const MIN_REQUEST_GAP_MS = 3000;
const REQUEST_TIMEOUT_MS = 12000;

// Artwork URLs come back at 100x100; the size is a path segment, so asking for
// a bigger one is a string replacement. 600 is sharp on a phone and ~40 kB,
// where 1000 is ~90 kB for no visible gain on the screens this runs on.
const ARTWORK_SIZE = '600x600bb.jpg';

interface ItunesResult {
  artistName?: string;
  trackName?: string;
  collectionName?: string;
  artworkUrl100?: string;
}

/**
 * Finds cover art for songs whose files carry none.
 *
 * Most of this library came off YouTube, where the audio has no embedded
 * picture and the title is whatever the uploader typed — so the query has to
 * be cleaned up before it is worth asking, and the answer has to be checked
 * before it is worth keeping. A wrong album cover is worse than a letter tile:
 * it looks deliberate.
 */
@Injectable({ providedIn: 'root' })
export class ArtworkService {
  private nextRequestAt = 0;

  /**
   * Returns cover art for a song, or null when nothing matched confidently.
   * Never throws: no artwork is a normal outcome, not an error.
   */
  async find(song: { title: string; artist: string; album?: string }): Promise<Blob | null> {
    const query = buildQuery(song);
    if (!query) return null;

    try {
      const results = await this.search(query);
      const match = pickMatch(results, song);
      if (!match?.artworkUrl100) return null;
      return await this.download(upsize(match.artworkUrl100));
    } catch {
      // Offline, rate-limited, or Apple had an opinion. Try again another day.
      return null;
    }
  }

  private async search(term: string): Promise<ItunesResult[]> {
    await this.waitForTurn();
    const url = `${SEARCH_ENDPOINT}?term=${encodeURIComponent(term)}&entity=song&limit=5`;
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) throw new Error(`iTunes search failed (${response.status})`);
    // Apple serves this as text/javascript; Response.json() parses it anyway.
    const body = (await response.json()) as { results?: ItunesResult[] };
    return body.results ?? [];
  }

  private async download(url: string): Promise<Blob | null> {
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    // The covers bucket only takes jpeg/png/webp, and Apple serves jpeg.
    if (!blob.size || !blob.type.startsWith('image/')) return null;
    return blob;
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // Spaces requests out so a backfill over a whole library stays inside what
  // Apple allows, without the caller having to think about it.
  private async waitForTurn(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextRequestAt - now);
    this.nextRequestAt = Math.max(now, this.nextRequestAt) + MIN_REQUEST_GAP_MS;
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  }
}

// --- query building and matching (exported for testing) ---

// Junk that uploaders append, which iTunes will never match on.
const NOISE = /\((?:[^)]*\b(?:official|oficial|video|audio|lyrics?|letra|visuali[sz]er|hd|4k|mv|remaster(?:ed)?|explicit)\b[^)]*)\)|\[(?:[^\]]*\b(?:official|oficial|video|audio|lyrics?|letra|visuali[sz]er|hd|4k|mv|remaster(?:ed)?|explicit)\b[^\]]*)\]/gi;
const FEATURING = /\s[\(\[]?\b(?:ft|feat|featuring|con)\b\.?\s.*$/i;

export function clean(text: string): string {
  return (text || '')
    .replace(NOISE, ' ')
    .replace(FEATURING, ' ')
    // Trailing punctuation from names like "YOU KNOW IT'S LOVEE-".
    .replace(/[\-_–—|]+\s*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Titles ripped from YouTube usually repeat the artist: "Artist ft Other -
 * Real Title (Video Oficial)". Dropping that prefix has to happen before the
 * "ft ..." rule, which would otherwise eat the actual title along with it.
 */
export function cleanTitle(title: string, artist: string): string {
  let working = (title || '').replace(NOISE, ' ');
  const separator = working.indexOf(' - ');
  if (separator > 0) {
    const before = normalise(working.slice(0, separator));
    const after = working.slice(separator + 3).trim();
    // Only when the left-hand side really is the artist, so a song genuinely
    // called "Something - Something" keeps its name.
    const artistKey = normalise(clean(artist));
    if (after && artistKey.length >= 4 && before.startsWith(artistKey)) working = after;
  }
  return clean(working);
}

export function buildQuery(song: { title: string; artist: string }): string {
  const title = cleanTitle(song.title, song.artist);
  const artist = clean(song.artist);
  // A title alone is still worth asking about; an artist alone is not, since
  // it would match any song they ever released.
  if (!title) return '';
  const placeholder = /^unknown artist$/i.test(artist);
  return placeholder || !artist ? title : `${artist} ${title}`;
}

// Comparison ignores case, accents and punctuation, so "Café Tacvba" and
// "Cafe Tacuba" do not miss each other over a diacritic.
export function normalise(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

// Placeholder names a ripper leaves behind, which are never worth matching on.
const GENERIC_TITLE = /^(?:track|audio|untitled|song|newrecording|recording)\d*$/;

// 2 = the same string, 1 = one contains the other, 0 = unrelated.
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 2;
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  // Very short strings match by accident far too easily.
  return shorter.length >= 4 && longer.includes(shorter) ? 1 : 0;
}

/**
 * Picks a result only if it plausibly *is* the song, and among the plausible
 * ones prefers the closest. iTunes always returns something for a vague query,
 * so taking the first hit blindly is how a library ends up decorated with the
 * wrong albums — and its first hit for "Blinding Lights" is a remix.
 */
export function pickMatch<T extends ItunesResult>(
  results: T[],
  song: { title: string; artist: string }
): T | null {
  const wantedTitle = normalise(cleanTitle(song.title, song.artist));
  const wantedArtist = normalise(clean(song.artist));
  const artistUnknown = !wantedArtist || /^unknownartist$/.test(wantedArtist);

  let best: T | null = null;
  let bestScore = 0;

  results.forEach((result, index) => {
    if (!result.artworkUrl100) return;
    const titleScore = similarity(normalise(result.trackName ?? ''), wantedTitle);
    if (!titleScore) return;

    const artistScore = similarity(normalise(result.artistName ?? ''), wantedArtist);
    // With no artist to check against there is nothing to confirm a match
    // against, so the title has to be exact *and* distinctive enough that an
    // exact hit means something. "Track 01" matches a stranger's "Track01"
    // perfectly, and the cover that comes back is simply somebody else's.
    if (artistUnknown) {
      if (titleScore < 2 || wantedTitle.length < 12 || GENERIC_TITLE.test(wantedTitle)) return;
    } else if (!artistScore) {
      return;
    }

    // Earlier results break ties, since iTunes orders by its own relevance.
    const score = titleScore * 10 + artistScore * 5 + (results.length - index);
    if (score > bestScore) {
      bestScore = score;
      best = result;
    }
  });

  return best;
}

export function upsize(artworkUrl: string): string {
  return artworkUrl.replace(/\/\d+x\d+[a-z]*\.jpg$/i, `/${ARTWORK_SIZE}`);
}
