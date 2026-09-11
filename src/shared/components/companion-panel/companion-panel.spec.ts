import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CompanionPanel } from './companion-panel';
import { AuthService } from '../../services/auth.service';
import { CompanionService, WorkerStatus } from '../../services/companion.service';
import { CompanionWorkerService } from '../../services/companion-worker.service';
import { ToastService } from '../../services/toast.service';

// Linking hands an admin account's password to a process on the phone, and
// stopping it silently stops everyone else's songs appearing. So: it is not
// offered where it cannot work, and stopping asks first.

describe('CompanionPanel', () => {
  let enabled: number;
  let disabled: number;
  let checks: number;
  let busy: ReturnType<typeof signal<boolean>>;
  let supported: ReturnType<typeof signal<boolean>>;
  let linked: ReturnType<typeof signal<boolean>>;

  async function render() {
    enabled = 0;
    disabled = 0;
    checks = 0;
    busy = signal(false);
    supported = signal(true);
    linked = signal(false);

    const status = signal<WorkerStatus | null>(null);

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [CompanionPanel],
      providers: [
        { provide: AuthService, useValue: { isAdmin: () => true } },
        {
          provide: CompanionService,
          useValue: {
            url: signal('http://127.0.0.1:8099').asReadonly(),
            token: signal('t').asReadonly(),
            configured: signal(true).asReadonly(),
            isLocal: signal(true).asReadonly(),
            health: signal(null).asReadonly(),
            checking: signal(false).asReadonly(),
            configure: () => {},
            forget: () => {},
            check: async () => {
              checks++;
              return { ok: true };
            },
          },
        },
        {
          provide: CompanionWorkerService,
          useValue: {
            busy: busy.asReadonly(),
            error: signal(null).asReadonly(),
            status: status.asReadonly(),
            supported: supported.asReadonly(),
            linked: linked.asReadonly(),
            summary: signal('Working as companion.worker@music-hub.local — 3 fetched.').asReadonly(),
            enable: async () => {
              enabled++;
              linked.set(true);
              return true;
            },
            disable: async () => {
              disabled++;
              linked.set(false);
              return true;
            },
          },
        },
        { provide: ToastService, useValue: { show: () => {}, error: () => {} } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CompanionPanel);
    fixture.detectChanges();
    return fixture;
  }

  // The confirm step arms a five-second timer, so `whenStable` would sit out
  // the whole countdown. Every handler here is settled after its microtasks.
  async function settle(fixture: { detectChanges(): void }): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  }

  function text(fixture: { nativeElement: HTMLElement }): string {
    return fixture.nativeElement.textContent ?? '';
  }

  function button(fixture: { nativeElement: HTMLElement }, label: string): HTMLButtonElement | undefined {
    return Array.from(fixture.nativeElement.querySelectorAll('button')).find(b =>
      (b.textContent ?? '').includes(label)
    ) as HTMLButtonElement | undefined;
  }

  it('offers linking only where the companion can actually work unattended', async () => {
    const fixture = await render();
    expect(text(fixture)).toContain('Fetch songs while the app is closed');

    supported.set(false);
    fixture.detectChanges();
    expect(text(fixture)).not.toContain('Fetch songs while the app is closed');
  });

  it('links, then offers re-linking and stopping instead', async () => {
    const fixture = await render();
    button(fixture, 'Link this companion')!.click();
    await settle(fixture);

    expect(enabled).toBe(1);
    expect(button(fixture, 'Link this companion')).toBeUndefined();
    expect(button(fixture, 'Re-link')).toBeDefined();
    expect(text(fixture)).toContain('3 fetched');
  });

  // One tap here would stop the family's songs arriving, with no undo prompt
  // anywhere else.
  it('asks before stopping the worker', async () => {
    const fixture = await render();
    linked.set(true);
    fixture.detectChanges();

    button(fixture, 'Stop')!.click();
    await settle(fixture);
    expect(disabled).toBe(0);
    expect(text(fixture)).toContain('Tap again to stop');

    button(fixture, 'Tap again to stop')!.click();
    await settle(fixture);
    expect(disabled).toBe(1);
  });

  // Without this, a companion set up weeks ago reports nothing until someone
  // taps "Save and test", and the linking section never appears.
  it('asks a configured companion what it is as soon as the panel opens', async () => {
    await render();
    expect(checks).toBe(1);
  });

  it('disables the buttons while a link is in flight', async () => {
    const fixture = await render();
    busy.set(true);
    fixture.detectChanges();
    expect(button(fixture, 'Linking…')!.disabled).toBe(true);
  });
});
