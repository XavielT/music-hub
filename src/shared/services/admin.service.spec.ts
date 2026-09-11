import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AdminService } from './admin.service';
import { AppSettingsService, DEFAULT_MAX_UPLOAD_MB, DEFAULT_LANGUAGE } from './app-settings.service';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { adminGuard } from '../guards/admin.guard';

// The panel is the least trustworthy part of this feature — it is the part an
// attacker can see. What is worth pinning down is that it never pretends an
// action worked, and that it reads its answers from the database rather than
// from what it just asked for.

describe('AdminService', () => {
  let service: AdminService;
  let rpcCalls: string[];
  let invoked: Record<string, unknown>[];
  let invokeResult: { data: unknown; error: unknown };
  let rows: unknown[];

  beforeEach(() => {
    rpcCalls = [];
    invoked = [];
    rows = [{ id: 'u1', email: 'a@b.c', display_name: 'A', role: 'member', disabled: false,
              created_at: '', last_sign_in_at: null, song_count: 2, bytes_used: 10 }];
    invokeResult = { data: { ok: true }, error: null };

    const supabase = {
      client: {
        rpc: (name: string) => {
          rpcCalls.push(name);
          return Promise.resolve({ data: rows, error: null });
        },
        functions: {
          invoke: (_name: string, options: { body: Record<string, unknown> }) => {
            invoked.push(options.body);
            return Promise.resolve(invokeResult);
          },
        },
      },
    };

    service = new AdminService(supabase as never, { user: () => ({ id: 'me' }) } as never);
  });

  it('reads the table from the admin-gated function', async () => {
    await service.load();
    expect(rpcCalls).toEqual(['admin_user_overview']);
    expect(service.users().length).toBe(1);
    expect(service.totalSongs()).toBe(2);
    expect(service.totalBytes()).toBe(10);
  });

  it('sends each action to the Edge Function, never to the table', async () => {
    await service.setRole('u1', 'listener');
    await service.setDisabled('u1', true);
    await service.deleteUser('u1');
    await service.sendReset('u1');

    expect(invoked.map(b => b['action'])).toEqual(['set-role', 'set-disabled', 'delete-user', 'send-reset']);
    expect(invoked[0]['role']).toBe('listener');
    expect(invoked[1]['disabled']).toBe(true);
  });

  // Without this the user sees "Edge Function returned a non-2xx status code",
  // which describes the transport and not the refusal.
  it('shows the sentence the function wrote when it refuses', async () => {
    invokeResult = {
      data: null,
      error: { context: new Response(JSON.stringify({ error: 'Only an admin can do that.' }), { status: 403 }) },
    };

    expect(await service.setRole('u1', 'admin')).toBe(false);
    expect(service.error()).toBe('Only an admin can do that.');
  });

  it('treats a 200 carrying an error as a failure', async () => {
    invokeResult = { data: { error: 'That is the last admin account.' }, error: null };
    expect(await service.setDisabled('u1', true)).toBe(false);
    expect(service.error()).toContain('last admin');
  });

  // A refused action must not leave the table showing what was asked for.
  it('reloads after an action so the table reflects the database', async () => {
    await service.setRole('u1', 'listener');
    expect(rpcCalls).toEqual(['admin_user_overview']);
  });

  it('knows which row is the admin themselves', () => {
    expect(service.isSelf('me')).toBe(true);
    expect(service.isSelf('u1')).toBe(false);
  });
});

describe('AppSettingsService', () => {
  let settings: AppSettingsService;
  let rows: { key: string; value: unknown }[];
  let selectError: unknown;
  let upsertError: unknown;
  let upserted: Record<string, unknown>[];

  function build(): AppSettingsService {
    const supabase = {
      client: {
        from: () => ({
          select: () => Promise.resolve({ data: rows, error: selectError }),
          upsert: (row: Record<string, unknown>) => {
            upserted.push(row);
            return Promise.resolve({ error: upsertError });
          },
        }),
      },
    };
    return new AppSettingsService(supabase as never);
  }

  beforeEach(() => {
    localStorage.removeItem('music-hub.app-settings');
    rows = [
      { key: 'max_upload_mb', value: 25 },
      { key: 'default_language', value: 'en' },
    ];
    selectError = null;
    upsertError = null;
    upserted = [];
    settings = build();
  });

  it('starts on the seeded defaults before anything is read', () => {
    expect(settings.maxUploadMb()).toBe(DEFAULT_MAX_UPLOAD_MB);
    expect(settings.defaultLanguage()).toBe(DEFAULT_LANGUAGE);
  });

  it('takes the admin-set values and reports the limit in bytes', async () => {
    await settings.load();
    expect(settings.maxUploadMb()).toBe(25);
    expect(settings.defaultLanguage()).toBe('en');
    expect(settings.maxUploadBytes()).toBe(25 * 1024 * 1024);
  });

  // The upload path reads this, so a device that started offline must not
  // silently fall back to a larger limit than the admin set.
  it('remembers the last known values for an offline start', async () => {
    await settings.load();
    selectError = { message: 'offline' };
    const fresh = build();
    expect(fresh.maxUploadMb()).toBe(25);
    await fresh.load();
    expect(fresh.maxUploadMb()).toBe(25);
  });

  it('ignores a nonsense value rather than capping uploads at zero', async () => {
    rows = [{ key: 'max_upload_mb', value: 'not a number' }];
    await settings.load();
    expect(settings.maxUploadMb()).toBe(DEFAULT_MAX_UPLOAD_MB);
  });

  it('hands back the database refusal when a non-admin tries to save', async () => {
    upsertError = { message: 'new row violates row-level security policy' };
    const failed = await settings.save('max_upload_mb', 90);
    expect(failed).toContain('row-level security');
    expect(settings.maxUploadMb()).toBe(DEFAULT_MAX_UPLOAD_MB);
  });
});

describe('adminGuard', () => {
  function run(isAdmin: boolean, signedIn: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isAdmin: () => isAdmin, signedIn: () => signedIn } },
        { provide: Router, useValue: { createUrlTree: (path: string[]) => ({ path }) } },
      ],
    });
    return TestBed.runInInjectionContext(() => adminGuard({} as never, {} as never));
  }

  it('lets an admin through', () => {
    expect(run(true, true)).toBe(true);
  });

  it('sends a signed-in non-admin back to the library', () => {
    expect(run(false, true)).toEqual({ path: ['/'] } as never);
  });

  it('sends a signed-out visitor to the sign-in screen', () => {
    expect(run(false, false)).toEqual({ path: ['/auth'] } as never);
  });
});
