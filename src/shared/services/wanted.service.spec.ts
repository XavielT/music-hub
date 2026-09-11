import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WantedService, WantedSong } from './wanted.service';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { I18nService } from './i18n.service';
import { LinkTrack } from './link-metadata.service';

// The wanted list is a notepad, so most of it is CRUD. What is worth testing is
// the matching — it is what decides whether a file somebody just added ticks a
// row off, and getting it wrong quietly marks the wrong song found.

const USER = { id: 'u1' };

function row(over: Partial<WantedSong> = {}): WantedSong {
  return {
    id: 'w1',
    owner_id: USER.id,
    title: 'Tú Me Dejaste De Querer',
    artist: 'C. Tangana',
    album: '',
    cover_url: null,
    source_url: null,
    created_at: '',
    acquired: false,
    ...over,
  };
}

describe('WantedService', () => {
  let rows: WantedSong[];
  let inserted: Record<string, unknown>[];
  let updates: { id: string; patch: Record<string, unknown> }[];
  let deleted: string[];
  let failWrites: boolean;

  function table() {
    return {
      select: () => ({
        order: async () => (failWrites ? { data: null, error: { message: 'offline' } } : { data: rows, error: null }),
      }),
      insert: async (payload: Record<string, unknown>[]) => {
        if (failWrites) return { error: { message: 'offline' } };
        inserted.push(...payload);
        rows = [...payload.map((p, i) => row({ ...p, id: `new${i}` } as Partial<WantedSong>)), ...rows];
        return { error: null };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          if (failWrites) return { error: { message: 'offline' } };
          updates.push({ id, patch });
          return { error: null };
        },
      }),
      delete: () => ({
        eq: async (_col: string, id: string) => {
          if (failWrites) return { error: { message: 'offline' } };
          deleted.push(id);
          return { error: null };
        },
      }),
    };
  }

  async function make(initial: WantedSong[], signedIn = true) {
    rows = initial;
    inserted = [];
    updates = [];
    deleted = [];
    failWrites = false;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        WantedService,
        { provide: SupabaseService, useValue: { client: { from: () => table() } } },
        { provide: AuthService, useValue: { user: signal(signedIn ? USER : null).asReadonly() } },
        { provide: I18nService, useValue: new I18nService() },
      ],
    });
    const service = TestBed.inject(WantedService);
    TestBed.flushEffects();
    await service.load();
    return service;
  }

  it('splits the list into still-wanted and already-found', async () => {
    const service = await make([row({ id: 'a' }), row({ id: 'b', acquired: true })]);
    expect(service.pending().map(i => i.id)).toEqual(['a']);
    expect(service.acquired().map(i => i.id)).toEqual(['b']);
  });

  it('matches through case, accents and punctuation', async () => {
    const service = await make([row()]);
    expect(service.matchFor('tu me dejaste de querer', 'C Tangana')?.id).toBe('w1');
    expect(service.matchFor('TÚ ME DEJASTE DE QUERER!', 'c. tangana')?.id).toBe('w1');
  });

  it('matches when either side has no artist, which files often do not', async () => {
    const service = await make([row({ artist: '' })]);
    expect(service.matchFor('Tú me dejaste de querer', 'Anybody')).toBeTruthy();

    const withArtist = await make([row()]);
    expect(withArtist.matchFor('Tú me dejaste de querer', '')).toBeTruthy();
  });

  it('does not match a different artist', async () => {
    const service = await make([row()]);
    expect(service.matchFor('Tú me dejaste de querer', 'Somebody Else')).toBeNull();
  });

  it('does not match on an empty title, which would match everything', async () => {
    const service = await make([row({ title: '' })]);
    expect(service.matchFor('', '')).toBeNull();
  });

  it('leaves an already-found entry alone — adding it again must not un-tick it', async () => {
    const service = await make([row({ acquired: true })]);
    expect(service.matchFor('Tú Me Dejaste De Querer', 'C. Tangana')).toBeNull();
  });

  it('adds every track of an album link in one call', async () => {
    const service = await make([]);
    const tracks: LinkTrack[] = [
      { title: 'One', artist: 'A', album: 'LP', year: 2020, durationSeconds: 100, coverUrl: 'c' },
      { title: 'Two', artist: 'A', album: 'LP', year: 2020, durationSeconds: 120, coverUrl: 'c' },
    ];
    expect(await service.add(tracks, 'https://open.spotify.com/album/x')).toBe(true);
    expect(inserted.length).toBe(2);
    expect(inserted[0]['owner_id']).toBe(USER.id);
    expect(inserted[0]['source_url']).toBe('https://open.spotify.com/album/x');
  });

  it('reports a refused write instead of pretending it worked', async () => {
    const service = await make([]);
    failWrites = true;
    const tracks: LinkTrack[] = [
      { title: 'One', artist: 'A', album: '', year: null, durationSeconds: 0, coverUrl: null },
    ];
    expect(await service.add(tracks, '')).toBe(false);
    expect(service.error()).toBe('offline');
  });

  it('puts an optimistic removal back when the delete is refused', async () => {
    const service = await make([row({ id: 'a' }), row({ id: 'b' })]);
    failWrites = true;
    await service.remove('a');
    expect(service.items().map(i => i.id)).toEqual(['a', 'b']);
    expect(service.error()).toBe('offline');
  });

  it('has no list at all when signed out', async () => {
    const service = await make([row()], false);
    expect(service.items()).toEqual([]);
  });
});
