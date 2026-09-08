// Pulled out of YoutubeService on purpose: that file dynamically imports
// youtubei.js, which the karma build cannot parse, so anything living beside
// it is untestable. This is a pure function over a string and deserves better.

/**
 * The video id out of whatever someone pasted.
 *
 * Covers what people actually paste: a normal watch link, a youtu.be share
 * link, Shorts, an embed, `/live/`, and **music.youtube.com** — which is the
 * one worth naming, because "copy link" in YouTube Music is how you would
 * share a song rather than a video, and it is the same id underneath.
 * A bare id is accepted too, since that is what half a search box gets.
 *
 * Anything with a `list=` and no `v=` is a playlist, and there is no single
 * song in it to add — null, so the caller searches instead of pretending.
 */
export function parseVideoId(text: string): string | null {
  const input = (text || '').trim();
  if (!input) return null;

  // Pasted on its own.
  if (/^[\w-]{11}$/.test(input)) return input;

  const patterns = [
    // ?v= on any youtube host, music.youtube.com included, wherever it sits
    // in the query string.
    /(?:^|\.|\/\/)(?:[\w-]+\.)*youtube\.com\/[^\s]*[?&]v=([\w-]{11})/i,
    /(?:^|\.|\/\/)(?:[\w-]+\.)*youtube\.com\/(?:shorts|embed|live|v)\/([\w-]{11})/i,
    /(?:^|\.|\/\/)youtu\.be\/([\w-]{11})/i,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  return null;
}
