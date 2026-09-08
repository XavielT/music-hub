import { _test } from './youtube-capture.service';

// The native half of this cannot be tested off a device. These two can, and
// they are the two that quietly corrupt things: a channel name that becomes a
// song's artist, and a megabyte of audio crossing the native bridge as text.

describe('cleanArtist', () => {
  it('drops the "- Topic" that auto-generated music channels carry', () => {
    expect(_test.cleanArtist('Kevin MacLeod - Topic')).toBe('Kevin MacLeod');
    expect(_test.cleanArtist('Some Artist - topic')).toBe('Some Artist');
  });

  it('leaves an ordinary channel name alone', () => {
    expect(_test.cleanArtist('Audio Library')).toBe('Audio Library');
    // A hyphen that is part of the name is not the suffix.
    expect(_test.cleanArtist('Anne-Marie')).toBe('Anne-Marie');
  });

  it('falls back rather than showing an empty artist', () => {
    expect(_test.cleanArtist('')).toBe('Unknown artist');
    expect(_test.cleanArtist(undefined)).toBe('Unknown artist');
    expect(_test.cleanArtist('   ')).toBe('Unknown artist');
    // A channel called exactly "- Topic" would otherwise decode to nothing.
    expect(_test.cleanArtist('- Topic')).toBe('Unknown artist');
  });
});

describe('base64ToBlob', () => {
  it('round-trips bytes exactly', async () => {
    const original = new Uint8Array([0, 1, 2, 253, 254, 255, 65, 0, 127]);
    const base64 = btoa(String.fromCharCode(...original));

    const blob = _test.base64ToBlob(base64, 'audio/mp4');
    const back = new Uint8Array(await blob.arrayBuffer());

    expect(blob.type).toBe('audio/mp4');
    expect(Array.from(back)).toEqual(Array.from(original));
  });

  it('handles a payload big enough to break the naive version', async () => {
    // String.fromCharCode(...bytes) over a whole song overflows the call
    // stack, which is why this chunks. 300 kB is past where that happens.
    const size = 300 * 1024;
    const original = new Uint8Array(size);
    for (let i = 0; i < size; i++) original[i] = i % 256;

    let binary = '';
    for (let i = 0; i < size; i += 8192) {
      binary += String.fromCharCode(...original.subarray(i, i + 8192));
    }
    const blob = _test.base64ToBlob(btoa(binary), 'audio/mp4');
    const back = new Uint8Array(await blob.arrayBuffer());

    expect(back.length).toBe(size);
    expect(back[0]).toBe(0);
    expect(back[size - 1]).toBe(original[size - 1]);
  });
});
