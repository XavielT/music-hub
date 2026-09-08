import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { LibraryComponent } from './library';
import { LibraryService } from '../../../shared/services/library.service';
import { PlayerService } from '../../../shared/services/player.service';
import { AuthService } from '../../../shared/services/auth.service';
import { SyncService } from '../../../shared/services/sync.service';
import { PlaylistModel } from '../../../shared/models/playlist.model';

// The playlists tab is now two lists rather than one, and which playlist lands
// in which is the whole point. Signing in is not possible here, so the tab is
// rendered against a stubbed library.

const ME = 'me-user';

function playlist(over: Partial<PlaylistModel> & { id: string; name: string }): PlaylistModel {
  return {
    songIds: [],
    coverColor: '#ff9000',
    createdAt: 0,
    ownerId: ME,
    syncState: 'synced',
    isShared: false,
    ...over,
  };
}

describe('Library playlists tab', () => {
  const mine = playlist({ id: 'p1', name: 'My mix' });
  const minePublic = playlist({ id: 'p2', name: 'Kitchen', isShared: true });
  const theirs = playlist({
    id: 'p3',
    name: 'Road trip',
    ownerId: 'them-user',
    isShared: true,
    ownerName: 'Ana',
  });

  async function render(all: PlaylistModel[]) {
    const isMine = (p: PlaylistModel) => !p.ownerId || p.ownerId === ME;
    const library = {
      playlists: signal(all).asReadonly(),
      songs: signal([]).asReadonly(),
      artists: signal([]).asReadonly(),
      albums: signal([]).asReadonly(),
      myPlaylists: () => all.filter(isMine),
      sharedWithMe: () => all.filter(p => !isMine(p)),
      isMine,
      playlistOwnerLabel: (p: PlaylistModel) => (isMine(p) ? '' : p.ownerName || 'someone else'),
      coverSrc: () => null,
      localOnlySongs: signal([]).asReadonly(),
    };

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [LibraryComponent],
      providers: [
        provideRouter([]),
        { provide: LibraryService, useValue: library },
        { provide: PlayerService, useValue: { current: signal(null).asReadonly() } },
        { provide: AuthService, useValue: { isAdmin: () => true, user: () => ({ id: ME }) } },
        {
          provide: SyncService,
          useValue: { syncing: signal(false).asReadonly(), uploading: signal(false).asReadonly() },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LibraryComponent);
    fixture.componentInstance.setTab('playlists');
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('puts somebody else\'s playlist under its own heading, with their name', async () => {
    const text = await render([mine, minePublic, theirs]);

    expect(text).toContain('My mix');
    expect(text).toContain('Shared with you');
    expect(text).toContain('Road trip');
    expect(text).toContain('by Ana');
    // Mine says who it is open to, rather than crediting me to myself.
    expect(text).toContain('Shared with everyone');
    expect(text).not.toContain('by me-user');
  });

  it('leaves out the shared heading when nobody has shared anything', async () => {
    const text = await render([mine]);

    expect(text).toContain('My mix');
    expect(text).not.toContain('Shared with you');
  });
});
