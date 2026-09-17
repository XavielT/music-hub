import { AuthComponent } from './auth';

// The invitee's half of the invite link. Everything here is about the token
// surviving the trip from the URL to signUp(), because if it does not, the
// person following the link lands on exactly the wall the link exists to
// remove — and does so with no way of knowing why.

describe('AuthComponent and the invite link', () => {
  const INVITE_KEY = 'music-hub.invite';

  function build(queryParams: Record<string, string>) {
    const signUpCalls: unknown[][] = [];
    const auth = {
      takeSignedOutReason: () => '',
      signedIn: () => false,
      signUp: (...args: unknown[]) => {
        signUpCalls.push(args);
        return Promise.resolve({ ok: true, message: '' });
      },
      signIn: () => Promise.resolve({ ok: true, message: '' }),
      sendPasswordReset: () => Promise.resolve({ ok: true, message: '' }),
    };
    const route = {
      snapshot: { queryParamMap: { get: (k: string) => queryParams[k] ?? null } },
    };
    const component = new AuthComponent(
      auth as never,
      { navigateByUrl: () => Promise.resolve(true) } as never,
      route as never,
      { t: (k: string) => k } as never
    );
    return { component, signUpCalls };
  }

  beforeEach(() => sessionStorage.removeItem(INVITE_KEY));
  afterEach(() => sessionStorage.removeItem(INVITE_KEY));

  it('opens on the register form when arriving on an invite link', () => {
    const { component } = build({ invite: 'tok-123' });
    expect(component.mode()).toBe('register');
    expect(component.inviteToken()).toBe('tok-123');
  });

  it('still opens on sign-in without one', () => {
    const { component } = build({});
    expect(component.mode()).toBe('login');
    expect(component.inviteToken()).toBe('');
  });

  it('hands the token to signUp, which is the only place it can be checked', async () => {
    const { component, signUpCalls } = build({ invite: 'tok-123' });
    component.email = 'her@example.com';
    component.password = 'a-long-enough-password';
    component.displayName = 'Her';
    await component.submit();
    expect(signUpCalls.length).toBe(1);
    expect(signUpCalls[0][3]).toBe('tok-123');
  });

  it('remembers the token when Safari drops the query string on reload', () => {
    build({ invite: 'tok-123' });
    // Second visit, same tab, no query string left on the URL.
    const { component } = build({});
    expect(component.inviteToken()).toBe('tok-123');
    expect(component.mode()).toBe('register');
  });

  it('ignores a blank invite parameter rather than claiming an invite', () => {
    const { component } = build({ invite: '   ' });
    expect(component.inviteToken()).toBe('');
    expect(component.mode()).toBe('login');
  });
});
