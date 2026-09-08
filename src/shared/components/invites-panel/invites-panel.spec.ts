import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { InvitesPanel } from './invites-panel';
import { AuthService } from '../../services/auth.service';
import { Invite, InvitesService } from '../../services/invites.service';

// Withdrawing an invite sits one tap away from a list of family names, so the
// two things worth rendering for are that it asks first, and that it is not
// there at all for someone who is not an admin.

const INVITES: Invite[] = [
  { email: 'ana@example.com', note: 'sister', created_at: '', has_joined: true },
  { email: 'bo@example.com', note: '', created_at: '', has_joined: false },
];

describe('InvitesPanel', () => {
  let removed: string[];
  let loads: number;

  async function render(isAdmin: boolean) {
    removed = [];
    loads = 0;

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [InvitesPanel],
      providers: [
        { provide: AuthService, useValue: { isAdmin: () => isAdmin } },
        {
          provide: InvitesService,
          useValue: {
            invites: signal(INVITES).asReadonly(),
            loading: signal(false).asReadonly(),
            busy: signal(false).asReadonly(),
            load: async () => void loads++,
            add: async () => true,
            remove: async (email: string) => void removed.push(email),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(InvitesPanel);
    fixture.detectChanges();
    return fixture;
  }

  it('shows who has joined and who has not', async () => {
    const fixture = await render(true);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('ana@example.com');
    expect(text).toContain('sister');
    expect(text).toContain('Joined');
    expect(text).toContain('bo@example.com');
    expect(text).toContain('Not yet');
    expect(loads).toBe(1);
  });

  it('asks before withdrawing an invite', async () => {
    const fixture = await render(true);
    const panel = fixture.componentInstance;

    await panel.remove('ana@example.com');
    expect(removed).toEqual([]);
    expect(panel.confirming()).toBe('ana@example.com');

    await panel.remove('ana@example.com');
    expect(removed).toEqual(['ana@example.com']);
    expect(panel.confirming()).toBeNull();
  });

  it('starts over when a different row is tapped', async () => {
    const fixture = await render(true);
    const panel = fixture.componentInstance;

    await panel.remove('ana@example.com');
    await panel.remove('bo@example.com');

    // The second tap arms the second row rather than confirming the first.
    expect(removed).toEqual([]);
    expect(panel.confirming()).toBe('bo@example.com');
  });

  it('is not there for a member who is not an admin', async () => {
    const fixture = await render(false);

    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
    // And it does not go asking for a list it would be refused.
    expect(loads).toBe(0);
  });
});
