import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { WelcomeBox } from './welcome-box';
import { AuthService } from '../../services/auth.service';
import { AppSettingsService } from '../../services/app-settings.service';
import { I18nService } from '../../services/i18n.service';
import { ProfileModel } from '../../models/profile.model';

// The box is shown once, to everybody, before they have used the app at all —
// so the two things worth rendering for are that it appears exactly when it has
// something to ask, and that every way out of it records that it was answered.

const USER = 'u1';

function profile(over: Partial<ProfileModel> = {}): ProfileModel {
  return {
    id: USER,
    display_name: 'Ana',
    created_at: '',
    is_admin: false,
    role: 'member',
    disabled: false,
    language: null,
    onboarded_at: null,
    ...over,
  };
}

describe('WelcomeBox', () => {
  let saved: { name?: string; language?: string };
  let onboarded: number;
  // Choosing a language here writes the same key the rest of the suite reads.
  let previousLang: string | null;

  beforeEach(() => (previousLang = localStorage.getItem('music-hub.lang')));

  async function render(p: ProfileModel | null, seenHere = false) {
    saved = {};
    onboarded = 0;
    localStorage.removeItem('music-hub.lang');
    if (seenHere) localStorage.setItem('music-hub.onboarded.' + USER, '1');
    else localStorage.removeItem('music-hub.onboarded.' + USER);

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [WelcomeBox],
      providers: [
        {
          provide: AuthService,
          useValue: {
            profile: signal(p).asReadonly(),
            saveLanguage: async (l: string) => void (saved.language = l),
            saveDisplayName: async (n: string) => void (saved.name = n),
            markOnboarded: async () => void onboarded++,
          },
        },
        { provide: AppSettingsService, useValue: { defaultLanguage: () => 'es' } },
        { provide: I18nService, useValue: new I18nService() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(WelcomeBox);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    localStorage.removeItem('music-hub.onboarded.' + USER);
    if (previousLang === null) localStorage.removeItem('music-hub.lang');
    else localStorage.setItem('music-hub.lang', previousLang);
  });

  it('asks an account that has never answered', async () => {
    const fixture = await render(profile());
    expect(fixture.componentInstance.visible()).toBe(true);
    expect(fixture.nativeElement.querySelector('.welcome-card')).toBeTruthy();
  });

  it('stays away from an account that already answered, on any device', async () => {
    const fixture = await render(profile({ onboarded_at: '2026-09-01T00:00:00Z' }));
    expect(fixture.componentInstance.visible()).toBe(false);
    expect(fixture.nativeElement.querySelector('.welcome-card')).toBeNull();
  });

  it('stays away once this device has recorded it, even with the row unwritten', async () => {
    const fixture = await render(profile(), true);
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('has nothing to ask before a profile has loaded', async () => {
    const fixture = await render(null);
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('applies a language choice immediately and stores it on the profile', async () => {
    const fixture = await render(profile());
    const box = fixture.componentInstance;
    await box.choose('es');
    expect(box.i18n.lang()).toBe('es');
    expect(saved.language).toBe('es');
  });

  it('pre-fills the name the account already has', async () => {
    const fixture = await render(profile());
    expect(fixture.componentInstance.name).toBe('Ana');
  });

  it('records the answer when it is finished, name and all', async () => {
    const fixture = await render(profile());
    const box = fixture.componentInstance;
    box.name = 'Ana María';
    while (!box.isLast()) box.next();
    box.next(); // the last "next" is Finish
    await fixture.whenStable();

    expect(onboarded).toBe(1);
    expect(saved.name).toBe('Ana María');
    expect(box.visible()).toBe(false);
    expect(localStorage.getItem('music-hub.onboarded.' + USER)).toBe('1');
  });

  it('records it when skipped too — nobody is asked this twice', async () => {
    const fixture = await render(profile());
    const box = fixture.componentInstance;
    await box.skip();
    expect(onboarded).toBe(1);
    expect(box.visible()).toBe(false);
  });

  it('walks forward and back without falling off either end', async () => {
    const fixture = await render(profile());
    const box = fixture.componentInstance;
    expect(box.index()).toBe(0);
    box.back();
    expect(box.index()).toBe(0);
    box.next();
    box.next();
    expect(box.step()).toBe('tour-add');
    box.back();
    expect(box.step()).toBe('name');
  });
});
