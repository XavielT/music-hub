import { parseVideoId } from './youtube-link';

// "Paste a YouTube link" is the feature people reach for first, and every app
// gets a different shape of link depending on which button the person pressed.
// The YouTube Music one matters most here: "copy link" on a song gives a
// music.youtube.com address, and that is how you would share a song rather
// than a video.

describe('parseVideoId', () => {
  
  const ID = 'dQw4w9WgXcQ';

  it('reads a YouTube Music link', () => {
    expect(parseVideoId(`https://music.youtube.com/watch?v=${ID}`)).toBe(ID);
    // What the Music app's share sheet actually produces.
    expect(
      parseVideoId(`https://music.youtube.com/watch?v=${ID}&si=Xk3nQ2f9aB1cD4eF`)
    ).toBe(ID);
    // And with the playlist parameter it adds when playing from an album.
    expect(
      parseVideoId(`https://music.youtube.com/watch?v=${ID}&list=OLAK5uy_abcdef`)
    ).toBe(ID);
  });

  it('reads the ordinary shapes', () => {
    expect(parseVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseVideoId(`https://youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseVideoId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(parseVideoId(`https://youtu.be/${ID}?si=abc123`)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
    expect(parseVideoId(`m.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('copes with the id not being the first parameter', () => {
    expect(parseVideoId(`https://www.youtube.com/watch?app=desktop&v=${ID}`)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/watch?v=${ID}&t=42s`)).toBe(ID);
  });

  it('takes a bare id, which is half of what gets pasted', () => {
    expect(parseVideoId(ID)).toBe(ID);
    expect(parseVideoId(`  ${ID}  `)).toBe(ID);
  });

  it('treats a search phrase as a search, not a link', () => {
    expect(parseVideoId('celtic impulse kevin macleod')).toBeNull();
    expect(parseVideoId('')).toBeNull();
    // Eleven characters, but with a space in it — a phrase, not an id.
    expect(parseVideoId('hello world')).toBeNull();
  });

  it('says no to a playlist, which has no single song to add', () => {
    expect(
      parseVideoId('https://music.youtube.com/playlist?list=OLAK5uy_abcdefghijk')
    ).toBeNull();
    expect(parseVideoId('https://www.youtube.com/playlist?list=PLabcdefghijk')).toBeNull();
  });
});
