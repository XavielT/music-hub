import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AllowanceService } from './allowance.service';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';

// The numbers on the upload screen. They decide nothing — the database refuses
// an over-quota insert on its own — but a share that reads wrong is a share
// somebody plans around wrongly.

describe('AllowanceService', () => {
  function make(row: Record<string, unknown> | null, signedIn = true, role = 'member') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AllowanceService,
        {
          provide: SupabaseService,
          useValue: { client: { rpc: async () => ({ data: row ? [row] : [], error: null }) } },
        },
        {
          provide: AuthService,
          useValue: {
            user: signal(signedIn ? { id: 'u1' } : null).asReadonly(),
            role: signal(role).asReadonly(),
          },
        },
      ],
    });
    const service = TestBed.inject(AllowanceService);
    TestBed.flushEffects();
    return service;
  }

  it('reports a member share as used, total and what is left', async () => {
    const service = make({ used_bytes: 50 * 1024 * 1024, quota_bytes: 150 * 1024 * 1024, is_unlimited: false });
    await service.load();
    expect(service.usedBytes()).toBe(50 * 1024 * 1024);
    expect(service.quotaBytes()).toBe(150 * 1024 * 1024);
    expect(service.remainingBytes()).toBe(100 * 1024 * 1024);
    expect(service.usedPercent()).toBe(33);
    expect(service.unlimited()).toBe(false);
  });

  it('has no ceiling for an admin, and nothing to draw a bar from', async () => {
    const service = make({ used_bytes: 900 * 1024 * 1024, quota_bytes: null, is_unlimited: true });
    await service.load();
    expect(service.unlimited()).toBe(true);
    expect(service.quotaBytes()).toBeNull();
    expect(service.remainingBytes()).toBeNull();
    expect(service.usedPercent()).toBe(0);
  });

  it('never reports a negative remainder when somebody is already over', async () => {
    const service = make({ used_bytes: 200 * 1024 * 1024, quota_bytes: 150 * 1024 * 1024, is_unlimited: false });
    await service.load();
    expect(service.remainingBytes()).toBe(0);
    expect(service.usedPercent()).toBe(100);
  });

  it('warns only once the share is nearly gone', async () => {
    const roomy = make({ used_bytes: 10, quota_bytes: 100, is_unlimited: false });
    await roomy.load();
    expect(roomy.nearlyFull()).toBe(false);

    const tight = make({ used_bytes: 90, quota_bytes: 100, is_unlimited: false });
    await tight.load();
    expect(tight.nearlyFull()).toBe(true);
  });

  it('holds nothing at all when signed out', () => {
    const service = make({ used_bytes: 5, quota_bytes: 10, is_unlimited: false }, false);
    expect(service.loaded()).toBe(false);
    expect(service.usedBytes()).toBe(0);
  });
});
