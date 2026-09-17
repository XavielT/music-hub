import { InviteLinksService } from './invite-links.service';
import { I18nService } from './i18n.service';

// The token comes back from the database exactly once and is never readable
// again, so the service's job is to turn it into a URL and hold it until the
// panel is left. Everything pinned here is about not losing it, and about not
// keeping it a moment longer than the screen that shows it.

describe('InviteLinksService', () => {
  let rpcCalls: { fn: string; args: unknown }[];
  let failWith: string | null;
  let toasts: string[];
  let errors: string[];
  let service: InviteLinksService;

  const rows = [
    {
      id: 'a1',
      note: 'her friend',
      created_at: '',
      expires_at: '',
      used_at: null,
      revoked_at: null,
      status: 'open',
    },
    {
      id: 'b2',
      note: '',
      created_at: '',
      expires_at: '',
      used_at: '2026-09-17',
      revoked_at: null,
      status: 'used',
    },
  ];

  beforeEach(() => {
    rpcCalls = [];
    failWith = null;
    toasts = [];
    errors = [];
    service = new InviteLinksService(
      {
        client: {
          rpc: async (fn: string, args: unknown) => {
            rpcCalls.push({ fn, args });
            if (failWith) return { data: null, error: { message: failWith } };
            if (fn === 'list_invite_links') return { data: rows, error: null };
            if (fn === 'create_invite_link') return { data: 'tok-en-123', error: null };
            return { data: null, error: null };
          },
        },
      } as never,
      { show: (m: string) => toasts.push(m), error: (m: string) => errors.push(m) } as never,
      new I18nService()
    );
  });

  it('loads the list', async () => {
    await service.load();
    expect(service.links().map(l => l.id)).toEqual(['a1', 'b2']);
  });

  it('turns the token into a link on this origin', async () => {
    const url = await service.create('her friend');
    expect(url).toBe(`${location.origin}/auth?invite=tok-en-123`);
    expect(service.lastCreated()).toBe(url);
  });

  it('refreshes the list after creating, so the new link is in it', async () => {
    await service.create('her friend');
    expect(rpcCalls.map(c => c.fn)).toEqual(['create_invite_link', 'list_invite_links']);
  });

  it('escapes a token that would otherwise break the query string', async () => {
    service = new InviteLinksService(
      {
        client: {
          rpc: async () => ({ data: 'a+b/c=d&e', error: null }),
        },
      } as never,
      { show: () => {}, error: () => {} } as never,
      new I18nService()
    );
    const url = await service.create('x');
    expect(url).toBe(`${location.origin}/auth?invite=a%2Bb%2Fc%3Dd%26e`);
  });

  it('forgets the token when asked, since it cannot be recovered anyway', async () => {
    await service.create('her friend');
    expect(service.lastCreated()).not.toBe('');
    service.clearLastCreated();
    expect(service.lastCreated()).toBe('');
  });

  it('reports a refusal as the sentence the function wrote', async () => {
    failWith = 'Only an admin can create an invite link.';
    const url = await service.create('x');
    expect(url).toBe('');
    expect(errors.length).toBe(1);
  });

  it('leaves the list empty rather than shouting when it cannot be read', async () => {
    failWith = 'network down';
    await service.load();
    expect(service.links()).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('never keeps a half-made link after a failure', async () => {
    failWith = 'nope';
    await service.create('x');
    expect(service.lastCreated()).toBe('');
  });
});
