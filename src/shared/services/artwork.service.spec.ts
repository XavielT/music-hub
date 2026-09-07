import { buildQuery, cleanTitle, normalise, pickMatch, upsize } from './artwork.service';

// The matching rules are the whole safety mechanism here: iTunes answers every
// query with something, so what stops a library being decorated with the wrong
// albums is entirely this logic. It is worth pinning down.

describe('artwork query building', () => {
  it('drops the artist prefix YouTube rips repeat in the title', () => {
    expect(
      cleanTitle("Yk It’s Junaa ft Myke Towers - YOU KNOW IT'S LOVEE- (Video Oficial)", 'Yk It’s Junaa')
    ).toBe("YOU KNOW IT'S LOVEE");
  });

  it('keeps a title that genuinely contains a dash', () => {
    expect(cleanTitle('Ready - Set - Go', 'Some Band')).toBe('Ready - Set - Go');
  });

  it('strips uploader noise and featuring credits', () => {
    expect(cleanTitle('Blinding Lights (Official Video)', 'The Weeknd')).toBe('Blinding Lights');
    expect(cleanTitle('Otro Trago feat. Nicky Jam', 'Sech')).toBe('Otro Trago');
  });

  it('leaves out a placeholder artist rather than searching for it', () => {
    expect(buildQuery({ title: 'Bohemian Rhapsody', artist: 'Unknown artist' })).toBe(
      'Bohemian Rhapsody'
    );
    expect(buildQuery({ title: 'Get Lucky', artist: 'Daft Punk' })).toBe('Daft Punk Get Lucky');
  });

  it('builds nothing when there is no title to go on', () => {
    expect(buildQuery({ title: '', artist: 'Daft Punk' })).toBe('');
  });

  it('ignores accents and punctuation when comparing', () => {
    expect(normalise('Café Tacvba')).toBe(normalise('cafe  tacvba!'));
  });
});

describe('artwork match selection', () => {
  const art = 'https://is1-ssl.mzstatic.com/image/thumb/x/y/100x100bb.jpg';
  const result = (artistName: string, trackName: string) => ({
    artistName,
    trackName,
    artworkUrl100: art,
  });

  it('prefers the exact track over a remix listed first', () => {
    const match = pickMatch(
      [
        result('The Weeknd & ROSALÍA', 'Blinding Lights (Remix)'),
        result('The Weeknd', 'Blinding Lights'),
      ],
      { title: 'Blinding Lights (Official Video)', artist: 'The Weeknd' }
    );
    expect(match?.trackName).toBe('Blinding Lights');
  });

  it('accepts a credited artist that is a superset of the tagged one', () => {
    const match = pickMatch([result('Daft Punk, Pharrell Williams & Nile Rodgers', 'Get Lucky')], {
      title: 'Get Lucky',
      artist: 'Daft Punk',
    });
    expect(match).toBeTruthy();
  });

  it('refuses a result whose artist is somebody else', () => {
    const match = pickMatch([result('A Completely Different Band', 'Get Lucky')], {
      title: 'Get Lucky',
      artist: 'Daft Punk',
    });
    expect(match).toBeNull();
  });

  it('refuses a generic title when there is no artist to confirm it', () => {
    // The trap: an exact string match that means nothing. Somebody else's
    // "Track01" is not this song's cover.
    expect(pickMatch([result('YOOKiE & KTRL', 'Track01')], {
      title: 'Track 01',
      artist: 'Unknown artist',
    })).toBeNull();
    expect(pickMatch([result('I Promised The World', '01')], {
      title: '01',
      artist: 'Unknown artist',
    })).toBeNull();
  });

  it('allows a distinctive title with no artist', () => {
    const match = pickMatch([result('Queen', 'Bohemian Rhapsody')], {
      title: 'Bohemian Rhapsody',
      artist: 'Unknown artist',
    });
    expect(match?.artistName).toBe('Queen');
  });

  it('ignores results that carry no artwork', () => {
    expect(
      pickMatch([{ artistName: 'Queen', trackName: 'Bohemian Rhapsody' }], {
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
      })
    ).toBeNull();
  });
});

describe('artwork url', () => {
  it('asks for a size worth showing on a phone', () => {
    expect(upsize('https://is1-ssl.mzstatic.com/image/thumb/a/b/100x100bb.jpg')).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/a/b/600x600bb.jpg'
    );
  });
});
