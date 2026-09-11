import { signal } from '@angular/core';
import { CompanionWorkerService, WORKER_EMAIL } from './companion-worker.service';
import { CompanionHealth, WorkerCredentials, WorkerStatus } from './companion.service';
import { environment } from '../../environments/environment';

// Linking mints a password for an account that may write to the shared
// library. The parts worth pinning down are the ones that decide whether that
// password ends up somewhere it should not be, and whether a half-finished
// link leaves an account nobody holds the password to.

function status(over: Partial<WorkerStatus> = {}): WorkerStatus {
  return {
    linked: true,
    signed_in: true,
    account: WORKER_EMAIL,
    completed: 3,
    failed: 0,
    last_activity: '2026-09-11T00:00:00Z',
    last_error: null,
    ...over,
  };
}

describe('CompanionWorkerService', () => {
  let service: CompanionWorkerService;

  let isAdmin: ReturnType<typeof signal<boolean>>;
  let health: ReturnType<typeof signal<CompanionHealth | null>>;

  let rpcCalls: { name: string; args: Record<string, unknown> }[];
  let rpcError: string | null;
  let linked: WorkerCredentials[];
  let linkError: string | null;
  let unlinked: number;

  beforeEach(() => {
    isAdmin = signal(true);
    health = signal<CompanionHealth | null>({ ok: true, where: 'termux', worker: status({ linked: false }) });
    rpcCalls = [];
    rpcError = null;
    linked = [];
    linkError = null;
    unlinked = 0;

    const supabase = {
      client: {
        rpc: (name: string, args: Record<string, unknown>) => {
          rpcCalls.push({ name, args });
          return Promise.resolve(
            rpcError ? { data: null, error: { message: rpcError } } : { data: WORKER_EMAIL, error: null }
          );
        },
      },
    };

    const companion = {
      health: health.asReadonly(),
      link: (credentials: WorkerCredentials) => {
        if (linkError) return Promise.reject(new Error(linkError));
        linked.push(credentials);
        health.set({ ok: true, where: 'termux', worker: status() });
        return Promise.resolve(status());
      },
      unlink: () => {
        unlinked++;
        health.set({ ok: true, where: 'termux', worker: status({ linked: false, signed_in: false }) });
        return Promise.resolve();
      },
    };

    service = new CompanionWorkerService(
      supabase as never,
      { isAdmin: isAdmin.asReadonly() } as never,
      companion as never
    );
  });

  it('provisions the account before handing it over, with this project as its target', async () => {
    expect(await service.enable()).toBe(true);

    expect(rpcCalls.length).toBe(1);
    expect(rpcCalls[0].name).toBe('provision_worker');
    expect(linked.length).toBe(1);
    expect(linked[0].email).toBe(WORKER_EMAIL);
    expect(linked[0].supabase_url).toBe(environment.supabaseUrl);
    expect(linked[0].anon_key).toBe(environment.supabaseAnonKey);
  });

  // The database's own floor is 24. A password that fails that check would
  // provision nothing and report an error nobody can act on.
  it('mints a long random password and sends the same one to both sides', async () => {
    await service.enable();
    const sent = rpcCalls[0].args['p_password'] as string;
    expect(sent.length).toBeGreaterThanOrEqual(24);
    expect(linked[0].password).toBe(sent);

    await service.enable();
    expect(rpcCalls[1].args['p_password']).not.toBe(sent);
  });

  it('keeps no copy of the password', async () => {
    await service.enable();
    expect(JSON.stringify(service)).not.toContain(linked[0].password);
  });

  it('refuses to link when this device is not an admin', async () => {
    isAdmin.set(false);
    expect(await service.enable()).toBe(false);
    expect(rpcCalls.length).toBe(0);
    expect(linked.length).toBe(0);
  });

  it('reports a refused provision without touching the companion', async () => {
    rpcError = 'Only an admin can set up the companion worker.';
    expect(await service.enable()).toBe(false);
    expect(linked.length).toBe(0);
    expect(service.error()).toContain('Only an admin');
  });

  // The account exists at this point, and the phone did not get the password.
  // Saying so is what makes "link again" the obvious next move.
  it('surfaces a companion that would not take the credentials', async () => {
    linkError = 'Supabase refused the worker account: invalid login';
    expect(await service.enable()).toBe(false);
    expect(service.error()).toContain('refused');
    expect(service.linked()).toBe(false);
  });

  it('reads linked and signed-in state from the companion, not from having linked', () => {
    health.set({ ok: true, where: 'termux', worker: status({ linked: true, signed_in: false }) });
    expect(service.linked()).toBe(true);
    expect(service.summary()).toContain('not signed in yet');

    health.set({ ok: true, where: 'termux', worker: status({ last_error: 'yt-dlp said no' }) });
    expect(service.summary()).toContain('yt-dlp said no');
  });

  // A hosted companion cannot work unattended, so the section stays hidden
  // rather than offering a button that would fail.
  it('is unsupported when the companion reports no worker', () => {
    health.set({ ok: true, where: 'docker' });
    expect(service.supported()).toBe(false);
    health.set({ ok: true, where: 'termux', worker: status() });
    expect(service.supported()).toBe(true);
  });

  it('stops the worker without removing the account', async () => {
    await service.enable();
    expect(await service.disable()).toBe(true);
    expect(unlinked).toBe(1);
    expect(service.linked()).toBe(false);
    // No second rpc: disabling is the companion forgetting, not a change in
    // the database.
    expect(rpcCalls.length).toBe(1);
  });
});
