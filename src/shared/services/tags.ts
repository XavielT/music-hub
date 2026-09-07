// Reads the tags an audio file already carries: title, artist, album and the
// embedded cover art.
//
// Before this, a song added from the device was named by splitting its
// filename on " - " and had no album and no artwork at all — so the Albums tab
// was empty for local files and every song showed a letter tile. The files
// almost always know better: ffmpeg carries tags and embedded art across when
// `tools/compress-for-cloud.sh` re-encodes, so the information is right there.
//
// Deliberately hand-rolled rather than pulling in a metadata library: the
// three containers that matter here are MP3 (ID3v2), M4A/MP4 — what the
// compress script produces — and FLAC, and a parser for those is far smaller
// than any dependency that would ship in the bundle. Anything unrecognised or
// malformed reads as "no tags" and the filename still wins.
//
// Only the slices it needs are read, so adding fifty songs does not pull fifty
// whole files into memory.

export interface TrackTags {
  title?: string;
  artist?: string;
  album?: string;
  picture?: Blob;
}

// Cover art far bigger than this is a scan nobody needs on a phone screen, and
// the Supabase covers bucket caps objects at 5 MB anyway.
const MAX_PICTURE_BYTES = 4 * 1024 * 1024;

export async function readTags(file: File): Promise<TrackTags> {
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (head.length < 12) return {};
    if (str(head, 0, 3) === 'ID3') return await readId3(file, head);
    if (str(head, 4, 4) === 'ftyp') return await readMp4(file);
    if (str(head, 0, 4) === 'fLaC') return await readFlac(file);
  } catch {
    // Truncated, unreadable or simply not tagged the way we expect. The
    // filename is a perfectly good fallback.
  }
  return {};
}

// --- ID3v2 (MP3) ---

async function readId3(file: File, head: Uint8Array): Promise<TrackTags> {
  const major = head[3];
  const unsynchronised = (head[5] & 0x80) !== 0;
  const hasExtendedHeader = (head[5] & 0x40) !== 0;
  const size = syncsafe(head, 6);
  if (!size || size > file.size) return {};

  let body = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
  // Whole-tag unsynchronisation (v2.3 and earlier): every 0xFF 0x00 pair in
  // the tag is a stuffed 0xFF. Undo it before walking frames, or every offset
  // after the first picture is wrong.
  if (unsynchronised) body = deunsynchronise(body);

  let offset = 0;
  if (hasExtendedHeader && body.length >= 4) {
    // v2.4 stores the extended header size as syncsafe and includes itself;
    // v2.3 stores it plain and excludes itself.
    offset += major >= 4 ? syncsafe(body, 0) : view(body).getUint32(0) + 4;
  }

  const idLength = major <= 2 ? 3 : 4;
  const headerLength = major <= 2 ? 6 : 10;
  const tags: TrackTags = {};
  let bestPictureRank = -1;

  while (offset + headerLength <= body.length) {
    const id = str(body, offset, idLength);
    // Padding: the rest of the tag is zeroes.
    if (!/^[A-Z0-9]+$/.test(id)) break;

    const frameSize =
      major <= 2
        ? (body[offset + 3] << 16) | (body[offset + 4] << 8) | body[offset + 5]
        : major >= 4
          ? syncsafe(body, offset + 4)
          : view(body).getUint32(offset + 4);
    const start = offset + headerLength;
    if (frameSize <= 0 || start + frameSize > body.length) break;
    const frame = body.subarray(start, start + frameSize);

    if (id === 'TIT2' || id === 'TT2') tags.title ??= textFrame(frame);
    else if (id === 'TPE1' || id === 'TP1') tags.artist ??= textFrame(frame);
    else if (id === 'TALB' || id === 'TAL') tags.album ??= textFrame(frame);
    else if (id === 'APIC' || id === 'PIC') {
      const found = pictureFrame(frame, id === 'PIC');
      // A file can hold several pictures; the front cover is the one to show,
      // otherwise take the first thing that decodes.
      if (found && found.rank > bestPictureRank) {
        bestPictureRank = found.rank;
        tags.picture = found.blob;
      }
    }

    offset = start + frameSize;
  }

  return clean(tags);
}

function textFrame(frame: Uint8Array): string | undefined {
  if (frame.length < 2) return undefined;
  return decodeText(frame[0], frame.subarray(1));
}

function pictureFrame(
  frame: Uint8Array,
  isV22: boolean
): { blob: Blob; rank: number } | undefined {
  if (frame.length < 4) return undefined;
  const encoding = frame[0];
  let offset = 1;
  let mime: string;

  if (isV22) {
    // v2.2 identifies the format with three characters ("JPG", "PNG").
    const format = str(frame, offset, 3).toUpperCase();
    mime = format === 'PNG' ? 'image/png' : 'image/jpeg';
    offset += 3;
  } else {
    const end = frame.indexOf(0, offset);
    if (end < 0) return undefined;
    mime = str(frame, offset, end - offset) || 'image/jpeg';
    offset = end + 1;
  }

  const pictureType = frame[offset++];
  // The description is terminated the same way the text is encoded, so UTF-16
  // needs a double null rather than a single one.
  const wide = encoding === 1 || encoding === 2;
  offset = skipTerminator(frame, offset, wide);
  if (offset <= 0 || offset >= frame.length) return undefined;

  const data = frame.subarray(offset);
  if (!data.length || data.length > MAX_PICTURE_BYTES) return undefined;
  // 3 is "cover (front)". Rank it above everything else, and rank a picture
  // with no type above nothing at all.
  return { blob: new Blob([data], { type: normaliseMime(mime) }), rank: pictureType === 3 ? 2 : 1 };
}

// --- MP4 / M4A ---

async function readMp4(file: File): Promise<TrackTags> {
  const moov = await findTopLevelAtom(file, 'moov');
  if (!moov) return {};
  // The whole moov is read at once: walking it through slices would mean a
  // request per atom, and it is small next to the audio it describes.
  const buffer = new Uint8Array(await file.slice(moov.start, moov.end).arrayBuffer());

  const udta = findAtom(buffer, 8, buffer.length, 'udta');
  if (!udta) return {};
  const meta = findAtom(buffer, udta.body, udta.end, 'meta');
  if (!meta) return {};
  // `meta` is a full box: four bytes of version and flags sit before its
  // children, unlike every other container here.
  const ilst = findAtom(buffer, meta.body + 4, meta.end, 'ilst');
  if (!ilst) return {};

  const tags: TrackTags = {};
  let offset = ilst.body;
  while (offset + 8 <= ilst.end) {
    const item = readAtomHeader(buffer, offset, ilst.end);
    if (!item) break;
    const data = findAtom(buffer, item.body, item.end, 'data');
    if (data) {
      // data = 4 bytes type/flags, 4 bytes locale, then the payload.
      const typeFlags = view(buffer).getUint32(data.body) & 0x00ffffff;
      const payload = buffer.subarray(data.body + 8, data.end);
      if (item.type === '©nam') tags.title ??= utf8(payload);
      else if (item.type === '©ART') tags.artist ??= utf8(payload);
      else if (item.type === '©alb') tags.album ??= utf8(payload);
      else if (item.type === 'covr' && !tags.picture && payload.length <= MAX_PICTURE_BYTES) {
        // 13 = JPEG, 14 = PNG. Some taggers leave it 0, so sniff as a backup.
        const mime = typeFlags === 14 ? 'image/png' : typeFlags === 13 ? 'image/jpeg' : sniff(payload);
        if (mime) tags.picture = new Blob([payload], { type: mime });
      }
    }
    offset = item.end;
  }

  return clean(tags);
}

// Walks only the top-level atom chain, reading 16 bytes per step, so a `moov`
// parked at the end of a big file costs nothing to reach.
async function findTopLevelAtom(
  file: File,
  type: string
): Promise<{ start: number; end: number } | null> {
  let offset = 0;
  while (offset + 8 <= file.size) {
    const header = new Uint8Array(await file.slice(offset, offset + 16).arrayBuffer());
    if (header.length < 8) return null;
    let size = view(header).getUint32(0);
    let bodyOffset = 8;
    if (size === 1) {
      if (header.length < 16) return null;
      // 64-bit size, for files past 4 GB.
      size = Number(view(header).getBigUint64(8));
      bodyOffset = 16;
    } else if (size === 0) {
      size = file.size - offset; // runs to the end of the file
    }
    if (size < bodyOffset) return null;
    if (str(header, 4, 4) === type) return { start: offset, end: Math.min(offset + size, file.size) };
    offset += size;
  }
  return null;
}

interface Atom {
  type: string;
  body: number; // first byte after the header
  end: number; // one past the last byte of the atom
}

function readAtomHeader(buffer: Uint8Array, offset: number, limit: number): Atom | null {
  if (offset + 8 > limit) return null;
  let size = view(buffer).getUint32(offset);
  let body = offset + 8;
  if (size === 1) {
    if (offset + 16 > limit) return null;
    size = Number(view(buffer).getBigUint64(offset + 8));
    body = offset + 16;
  }
  if (size < body - offset || offset + size > limit) return null;
  return { type: str(buffer, offset + 4, 4), body, end: offset + size };
}

function findAtom(buffer: Uint8Array, from: number, limit: number, type: string): Atom | null {
  let offset = from;
  while (offset + 8 <= limit) {
    const atom = readAtomHeader(buffer, offset, limit);
    if (!atom) return null;
    if (atom.type === type) return atom;
    offset = atom.end;
  }
  return null;
}

// --- FLAC ---

async function readFlac(file: File): Promise<TrackTags> {
  const tags: TrackTags = {};
  let offset = 4; // past "fLaC"
  for (let block = 0; block < 64; block++) {
    const header = new Uint8Array(await file.slice(offset, offset + 4).arrayBuffer());
    if (header.length < 4) break;
    const last = (header[0] & 0x80) !== 0;
    const type = header[0] & 0x7f;
    const length = (header[1] << 16) | (header[2] << 8) | header[3];
    const start = offset + 4;

    if (type === 4) {
      readVorbisComments(new Uint8Array(await file.slice(start, start + length).arrayBuffer()), tags);
    } else if (type === 6 && !tags.picture && length <= MAX_PICTURE_BYTES) {
      readFlacPicture(new Uint8Array(await file.slice(start, start + length).arrayBuffer()), tags);
    }

    offset = start + length;
    if (last) break;
  }
  return clean(tags);
}

// Vorbis comments are "KEY=value" strings with little-endian lengths — the one
// place in this file where the byte order flips.
function readVorbisComments(block: Uint8Array, tags: TrackTags): void {
  const dv = view(block);
  let offset = 4 + dv.getUint32(0, true); // skip the vendor string
  if (offset + 4 > block.length) return;
  const count = dv.getUint32(offset, true);
  offset += 4;
  for (let i = 0; i < count && offset + 4 <= block.length; i++) {
    const length = dv.getUint32(offset, true);
    offset += 4;
    if (offset + length > block.length) return;
    const [key, ...rest] = utf8(block.subarray(offset, offset + length)).split('=');
    const value = rest.join('=');
    const name = key.toUpperCase();
    if (name === 'TITLE') tags.title ??= value;
    else if (name === 'ARTIST') tags.artist ??= value;
    else if (name === 'ALBUM') tags.album ??= value;
    offset += length;
  }
}

function readFlacPicture(block: Uint8Array, tags: TrackTags): void {
  const dv = view(block);
  let offset = 4; // picture type
  const mimeLength = dv.getUint32(offset);
  offset += 4;
  const mime = str(block, offset, mimeLength);
  offset += mimeLength;
  const descriptionLength = dv.getUint32(offset);
  offset += 4 + descriptionLength;
  offset += 16; // width, height, colour depth, colours used
  const dataLength = dv.getUint32(offset);
  offset += 4;
  if (!dataLength || offset + dataLength > block.length) return;
  tags.picture = new Blob([block.subarray(offset, offset + dataLength)], {
    type: normaliseMime(mime),
  });
}

// --- shared helpers ---

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function str(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '').trim();
}

// ID3 sizes are "syncsafe": seven bits per byte, so the tag can never contain
// a byte sequence a decoder would mistake for the start of an audio frame.
function syncsafe(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function deunsynchronise(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[length++] = bytes[i];
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return out.subarray(0, length);
}

function decodeText(encoding: number, bytes: Uint8Array): string | undefined {
  try {
    switch (encoding) {
      case 0:
        // Nominally ISO-8859-1, but taggers routinely put Windows-1252 in it,
        // which is a superset — decoding as 1252 loses nothing and saves the
        // curly quotes and dashes that would otherwise come out as boxes.
        return new TextDecoder('windows-1252').decode(bytes).replace(/\0+$/, '').trim();
      case 1: {
        // UTF-16 with a byte-order mark.
        const littleEndian = !(bytes[0] === 0xfe && bytes[1] === 0xff);
        const body = bytes[0] === 0xff || bytes[0] === 0xfe ? bytes.subarray(2) : bytes;
        return new TextDecoder(littleEndian ? 'utf-16le' : 'utf-16be')
          .decode(body)
          .replace(/\0+$/, '')
          .trim();
      }
      case 2:
        return new TextDecoder('utf-16be').decode(bytes).replace(/\0+$/, '').trim();
      default:
        return utf8(bytes);
    }
  } catch {
    return undefined;
  }
}

// Walks past a null-terminated string, allowing for UTF-16's two-byte nulls.
function skipTerminator(bytes: Uint8Array, offset: number, wide: boolean): number {
  if (!wide) {
    const end = bytes.indexOf(0, offset);
    return end < 0 ? -1 : end + 1;
  }
  for (let i = offset; i + 1 < bytes.length; i += 2) {
    if (bytes[i] === 0 && bytes[i + 1] === 0) return i + 2;
  }
  return -1;
}

// Only the three types the covers bucket accepts get through; anything else
// would upload fine and then fail to render.
function normaliseMime(mime: string): string {
  const value = mime.trim().toLowerCase();
  if (value.includes('png')) return 'image/png';
  if (value.includes('webp')) return 'image/webp';
  return 'image/jpeg';
}

// For taggers that leave the format field empty: identify by magic bytes.
function sniff(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && str(bytes, 1, 3) === 'PNG') return 'image/png';
  if (str(bytes, 0, 4) === 'RIFF' && str(bytes, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

// Empty strings are worse than nothing: they would override the filename guess
// with a blank title.
function clean(tags: TrackTags): TrackTags {
  const out: TrackTags = {};
  if (tags.title?.trim()) out.title = tags.title.trim();
  if (tags.artist?.trim()) out.artist = tags.artist.trim();
  if (tags.album?.trim()) out.album = tags.album.trim();
  if (tags.picture?.size) out.picture = tags.picture;
  return out;
}
