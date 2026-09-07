import { readTags } from './tags';

// music-metadata is loaded dynamically and only runs in a browser, so the one
// thing worth proving is that it actually parses a real file once bundled —
// including the text encodings and the embedded picture. The fixture is a
// 0.3 s MP3 with an ID3v2.3 tag and a 48x48 JPEG cover, inline so the suite
// needs no server or fixtures directory.
const TAGGED_MP3_BASE64 =
  'SUQzAwAAAAADClRBTEIAAAAJAAAB//5SAOkAAABUSVQyAAAAIQAAAf/+VADtAHQAdQBsAG8AIABQAHIAbwBiAGEAZABvAAAA' +
  'VFBFMQAAABsAAAH//kMAYQBmAOkAIABUAGEAYwB2AGIAYQAAAFRTU0UAAAAPAAAATGF2ZjYwLjE2LjEwMABBUElDAAAA+gAA' +
  'AGltYWdlL2pwZWcAAAD/2P/gABBKRklGAAECAAABAAEAAP/+ABBMYXZjNjAuMzEuMTAyAP/bAEMACAQEBAQEBQUFBQUFBgYG' +
  'BgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEwAAQEAAAAAAAAAAAAAAAAAAAAF' +
  'AQEBAAAAAAAAAAAAAAAAAAAABhABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIADAAMAMBIgACEQAD' +
  'EQD/2gAMAwEAAhEDEQA/AIIC7ToAAAAAAAAAAAAAAAD/2QAAAAAAAAAAAAD/+0DAAAAAAAAAAAAAAAAAAAAAAABJbmZvAAAA' +
  'DwAAAA0AAAYEAC8vLy8vLy9AQEBAQEBAQFJSUlJSUlJSY2NjY2NjY3V1dXV1dXV1hoaGhoaGhoaXl5eXl5eXqampqampqam6' +
  'urq6urq6usvLy8vLy8vd3d3d3d3d3e7u7u7u7u7u/////////wAAAABMYXZmAAAAAAAAAAAAAAAAAAAAAAAkBJIAAAAAAAAG' +
  'BEFKgDEAAAAAAP/7EMQAAAR0E1VUkIAwpgmvNxogAgABrTlAAAFZOj1QUAgGCQHwfB8HygIAgGEQfB/UCDsTh/iDcAST9sBg' +
  'OBwOAAAAAAAoiSqZFGQI6QJIFqP3hQHwExvwIpQvqBoS/CQNKgoAGDAA//sSxAKDxVgdIB3gACibA+NBr2hMzAkAvEAEhgDg' +
  'eGfu9qZjA5ZhxBEmDAB+YEIGBgUgTGBeA8WatJWHmCCGZPnEtGF+KKar1KJqfiimGEDMc96Z9KZo8ZuOYkK4lOCbvqow0OMO' +
  'HTHT//sQxAODxQQfGA37IkCthGKBv2xIgz6DMK8b41DOHDTrG0MJ4G01zAIGbqh1fmsGyaWhz9f0JEGJiJmxwbvGmJcO0cFf' +
  'XBv8DuGJqE+cIyGeIxmZ+Zk8GLCzB4xT4B/6voowoRMPHDH/+xLEAwPFAB8YDfsiQKsEIoG/bEijsz2GMKYck02+azS4G/MJ' +
  'cHA0kQEEbyZ2+GuEzWeDf6/oR/MUDjOTU3qEMTUcc4VuITgjHJMToJo4VlM7RzMD4y99MVF10S+oDn7PujCxAwwfMZP/+xDE' +
  'A4PFAB8YDfsiQKcEIoGvbEjDOIkwnx0jSk60NIUcgwjAdTNUAwpwoHdybALNp0Ofp+hJAy403TA/v8xOhsDh/2COEobQxPwl' +
  'ThmIzpIMvQTLH4xIYXXKMwT/d6owwsw5YyDM1f/7EsQEA8TQHxoNeyJAj4Pjga9oTfYwgBnzPh0jM8QZUwcQZjCRDAjaJOeo' +
  'DTM1njP6fsZuDghlx5wHRhZh0mow82afIdZhaAkHFXmXPmONGNggEHDlcjUwoowxkx7Q03sweRpjOu1aM//7EMQIg8SkHxoN' +
  'eyJgkAPjga9oTZUZwwaAawCoHCm6Mc04KlZtOmv1NABwczAw4Lcwtg3DUtc0NQwN4wuQRTiLDKHjGnTFQgIEf+oGKjABzAkj' +
  'DKzN6jBeF1Mwu+Uy9BbTBRBcCiI0//sSxA0DxJgfHA17ImCEg6PBn2RNEawJwtBDze2jP6mrhgBpintQYT4WJpML6mj6FqYU' +
  'AGx8xmeyYyxh8g0GMBkwoowRkxbYz38wZxsjNC3AMysaowVgcRC0PGm+AdT4OpaFOmv0MdDB//sQxBQDxKQfGg17ImCPA+OB' +
  'r2hNZmhBxVpheBgGqmy8amAYRhegenEVGUPGLOmGiAwI/9QsMECzAxgwg3MbgDBeG5Mwve0y9BsTBNByGHSZIBenW0EVNBnl' +
  'VvBwgzYU4igwvwsTViX/+xLEGQPEiB8aDfsiaI8D44GvaE3tNUELUwvgODjqTJnzEHjCxwaFhiuRAIYCEzArDIbzBHGEMnTF' +
  'gyYxfDA4BjLDBQYDsjiRDnW+smv1rNEh5nARx0ZhgBQGrmroapwUxhgganEUGST/+xDEHwPEhB8cDXsiYI6D44GvaE0GHPmA' +
  'jBQJDdSqDABHcAoEZgagdmDaHCYYqrJi3AvmBWACAgF0E6lZbpZ0UEAggf4DAYDgYCgAAAAAe0X3RcAuot/3P8rXLFu8iuBA' +
  'cHT8DgoDMP/7EsQkgARUHSgV4AApDhOtdzEwCj8L6B74xn+HKADDC0cR//5LEXImMwQT/9B0DQvp1ZmddIv8YRGUQGEmE70Z' +
  'nZp/n+f6Ho1GgESvhQUCgoKCi//+qkxBTUUzLjEwMKqqqqqqqqqqqv/7EMQbA8RkKzwdgYAIAAA0gAAABKqqqqqqqqqqqqqq' +
  'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

function fixture(name = 'tagged.mp3'): File {
  const binary = atob(TAGGED_MP3_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: 'audio/mpeg' });
}

describe('readTags', () => {
  it('reads title, artist, album and duration out of a real file', async () => {
    const tags = await readTags(fixture());

    // Accented text has to survive the tag's encoding.
    expect(tags.title).toBe('Título Probado');
    expect(tags.artist).toBe('Café Tacvba');
    expect(tags.album).toBe('Ré');
    // The fixture is 0.3 s, which rounds to zero — and zero means "unknown"
    // elsewhere, so it is clamped rather than lost.
    expect(tags.duration).toBe(1);
  });

  it('extracts the embedded cover, already shrunk', async () => {
    const tags = await readTags(fixture());

    expect(tags.picture).toBeTruthy();
    expect(tags.picture!.size).toBeGreaterThan(0);
    const bitmap = await createImageBitmap(tags.picture!);
    // The fixture cover is 48x48, comfortably under the 512 cap, so it comes
    // through at its own size rather than being blown up.
    expect(bitmap.width).toBe(48);
    expect(bitmap.height).toBe(48);
    bitmap.close();
  });

  it('returns nothing for a file it cannot parse, rather than throwing', async () => {
    // The song still has to be addable — the filename is the fallback.
    const junk = new File([new Uint8Array([1, 2, 3, 4, 5])], 'junk.mp3', { type: 'audio/mpeg' });

    await expectAsync(readTags(junk)).toBeResolved();
    expect(await readTags(junk)).toEqual({});
  });

  it('returns nothing for an untagged file', async () => {
    const tags = await readTags(new File([new Uint8Array(0)], 'empty.mp3', { type: 'audio/mpeg' }));
    expect(tags.title).toBeUndefined();
  });
});
