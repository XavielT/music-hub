// Reads what an audio file already knows about itself: title, artist, album,
// duration and embedded cover art.
//
// Parsing is done by `music-metadata`, imported dynamically so none of it
// reaches the initial bundle — it costs ~0.1 kB of transfer there, and the
// per-format parsers load only for the format actually being read. That buys
// Ogg/Opus, WAV, AIFF and Matroska alongside MP3/M4A/FLAC, which is the whole
// list the add-music file picker accepts.
//
// Nothing in here is allowed to stop a song being added: a file that cannot be
// parsed simply returns nothing and the filename is used instead.

export interface TrackTags {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  picture?: Blob;
}

// Album art is shown at 320 px at the very largest (the full-screen player on
// a big phone), so anything past this is bytes nobody sees — and the covers
// bucket only accepts images up to 5 MB.
const MAX_COVER_EDGE = 512;
const JPEG_QUALITY = 0.85;

export async function readTags(file: File): Promise<TrackTags> {
  try {
    const { parseBlob } = await import('music-metadata');
    const metadata = await parseBlob(file, { duration: true });
    const common = metadata.common;
    const picture = common.picture?.[0];

    return clean({
      title: common.title,
      // Falling back to the album artist keeps compilations sensible.
      artist: common.artist ?? common.albumartist,
      album: common.album,
      duration: metadata.format.duration,
      picture: picture
        ? await shrinkCover(new Blob([picture.data as Uint8Array], { type: picture.format }))
        : undefined,
    });
  } catch (err) {
    // Corrupt, truncated, or a format the parser does not know. The filename
    // is a perfectly good fallback, and the song still gets added.
    console.warn('tag parsing failed', err);
    return {};
  }
}

/**
 * Scales cover art down to something worth storing.
 *
 * Embedded art is routinely 1500×1500 and over a megabyte — a real cost when
 * it is held on the device, uploaded to a shared 1 GB bucket, and fetched
 * again on every other device. Returns the original untouched if shrinking it
 * would not actually help.
 */
export async function shrinkCover(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, MAX_COVER_EDGE / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return blob;
    }
    // JPEG has no alpha, and an unpainted canvas would turn a transparent PNG
    // cover black rather than leaving it light.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const shrunk = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    // Re-encoding a small, already-efficient cover can make it bigger.
    return shrunk && shrunk.size > 0 && shrunk.size < blob.size ? shrunk : blob;
  } catch {
    // No canvas, or an image the browser will not decode. Keep what we have —
    // the bucket's own limits are the backstop.
    return blob;
  }
}

// Empty strings are worse than nothing: they would override the filename guess
// with a blank title.
function clean(tags: TrackTags): TrackTags {
  const out: TrackTags = {};
  if (tags.title?.trim()) out.title = tags.title.trim();
  if (tags.artist?.trim()) out.artist = tags.artist.trim();
  if (tags.album?.trim()) out.album = tags.album.trim();
  if (tags.duration && isFinite(tags.duration) && tags.duration > 0) {
    // Stored as whole seconds (the cloud column is an integer), but never
    // rounded down to zero — a duration of 0 reads as "unknown" everywhere
    // else and would send the app off to decode the file again.
    out.duration = Math.max(1, Math.round(tags.duration));
  }
  if (tags.picture?.size) out.picture = tags.picture;
  return out;
}
