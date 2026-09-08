import { InvitesService } from './invites.service';

// The invite functions raise their own sentences, written for the person who
// will read them, and everything else is a connection problem. Getting that
// split wrong means either a raw Postgres error in a toast or a real refusal
// disguised as a network blip, so it is pinned here.

describe('InvitesService', () => {
  let rpcCalls: { fn: string; args: unknown }[];
  let failWith: string | null;
  let toasts: string[];
  let errors: string[];
  let service: InvitesService;

  beforeEach(() => {
    rpcCalls = [];
    failWith = null;
    toasts = [];
    errors = [];
    service = new InvitesService(
      {
        client: {
          rpc: async (fn: string, args: unknown) => {
            rpcCalls.push({ fn, args });
            if (failWith) return { data: null, error: { message: failWith } };
            return {
              data:
                fn === 'list_invites'
                  ? [
                      { email: 'ana@example.com', note: 'sister', created_at: '', has_joined: true },
                      { email: 'bo@example.com', note: '', created_at: '', has_joined: false },
                    ]
                  : null,
              error: null,
            };
          },
        },
      } as never,
      { show: (m: string) => toasts.push(m), error: (m: string) => errors.push(m) } as never
    );
  });

  it('loads the list', async () => {
    await service.load();
    expect(service.invites().map(i => i.email)).toEqual(['ana@example.com', 'bo@example.com']);
  });

  it('leaves the list empty and says nothing when it cannot be read', async () => {
    failWith = 'Only an admin can see the invite list.';
    await service.load();

    expect(service.invites()).toEqual([]);
    // Arriving in settings is not the moment for a toast about it.
    expect(errors).toEqual([]);
  });

  it('adds an invite and reloads the list', async () => {
    const ok = await service.add('  New.Person@Example.com ', 'cousin');

    expect(ok).toBe(true);
    expect(rpcCalls.map(c => c.fn)).toEqual(['add_invite', 'list_invites']);
    // The address is normalised in the database; the toast says what was
    // actually stored rather than what was typed.
    expect(toasts[0]).toContain('new.person@example.com');
  });

  it('passes a refusal through in the words it came in', async () => {
    failWith = 'That does not look like an email address.';
    const ok = await service.add('nonsense', '');

    expect(ok).toBe(false);
    expect(errors).toEqual(['That does not look like an email address.']);
  });

  it('turns anything else into a connection problem', async () => {
    failWith = 'TypeError: Failed to fetch';
    await service.add('someone@example.com', '');

    expect(errors[0]).toContain('connection');
    expect(errors[0]).not.toContain('TypeError');
  });

  it('refuses to send an empty address at all', async () => {
    expect(await service.add('   ', '')).toBe(false);
    expect(rpcCalls).toEqual([]);
  });
});
