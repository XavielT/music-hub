import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthComponent } from '../../app/pages/auth/auth';
import { WelcomeBox } from '../components/welcome-box/welcome-box';
import { WantedPanel } from '../components/wanted-panel/wanted-panel';
import { AuthService } from '../services/auth.service';
import { AppSettingsService } from '../services/app-settings.service';
import { WantedService } from '../services/wanted.service';
import { ToastService } from '../services/toast.service';
import { I18nService } from '../services/i18n.service';
import { ES } from './es';

/**
 * Renders real screens in Spanish and reads the words back off them.
 *
 * This exists because the visual pass everyone assumed would happen could not:
 * the browser in this environment cannot reach a local server, and loading the
 * whole app from file:// leaves the renderer unresponsive. Karma runs the same
 * Chrome perfectly well against components, so the check moved here.
 *
 * It is not a substitute for looking at the thing — nothing here would notice a
 * Spanish string overflowing its button, and that is the failure mode a longer
 * language actually has. What it does prove is that the pipe resolves through
 * real templates, that the dictionary reaches the screen, and that no English
 * is left sitting in the markup of the screens it covers.
 */
describe('renders in Spanish', () => {
  let previousLang: string | null;

  beforeEach(() => {
    previousLang = localStorage.getItem('music-hub.lang');
    localStorage.setItem('music-hub.lang', 'es');
  });

  afterEach(() => {
    if (previousLang === null) localStorage.removeItem('music-hub.lang');
    else localStorage.setItem('music-hub.lang', previousLang);
  });

  function spanish(): I18nService {
    const i18n = new I18nService();
    i18n.use('es');
    return i18n;
  }

  it('shows the sign-in screen in Spanish, and no English left in the markup', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AuthComponent],
      providers: [
        { provide: I18nService, useValue: spanish() },
        {
          provide: AuthService,
          useValue: {
            takeSignedOutReason: () => '',
            signedIn: () => false,
            signIn: async () => ({ ok: true, message: '' }),
          },
        },
        { provide: Router, useValue: { navigateByUrl: async () => true } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AuthComponent);
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;

    expect(text).toContain(ES['auth.tagline']);
    expect(text).toContain(ES['auth.signIn']);
    expect(text).toContain(ES['auth.register']);
    expect(text).toContain(ES['auth.forgotPassword']);
    expect(text).toContain(ES['auth.noAccount']);

    // The English these replaced must be gone, not merely covered up.
    expect(text).not.toContain('Sign in');
    expect(text).not.toContain('Forgot password');
    expect(text).not.toContain('Your library, on every device');

    // Placeholders are attributes, so they are worth checking separately —
    // they were the easiest thing to leave behind when the templates changed.
    const placeholders = Array.from(
      fixture.nativeElement.querySelectorAll('input')
    ).map((i: unknown) => (i as HTMLInputElement).placeholder);
    expect(placeholders).toContain(ES['auth.email']);
    expect(placeholders).toContain(ES['auth.password']);
  });

  it('shows the welcome box in Spanish, including the button that finishes it', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [WelcomeBox],
      providers: [
        { provide: I18nService, useValue: spanish() },
        {
          provide: AuthService,
          useValue: {
            profile: signal({
              id: 'u1',
              display_name: 'Ana',
              created_at: '',
              is_admin: false,
              role: 'member',
              disabled: false,
              language: null,
              onboarded_at: null,
            }).asReadonly(),
            saveLanguage: async () => undefined,
            saveDisplayName: async () => undefined,
            markOnboarded: async () => undefined,
          },
        },
        { provide: AppSettingsService, useValue: { defaultLanguage: () => 'es' } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(WelcomeBox);
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;

    expect(text).toContain(ES['welcome.languageTitle']);
    expect(text).toContain(ES['welcome.languageBody']);
    expect(text).toContain(ES['welcome.next']);
    expect(text).toContain(ES['welcome.skip']);
    expect(text).not.toContain('Choose your language');
    expect(text).not.toContain('Skip');
  });

  it('shows the wanted list in Spanish, empty state and all', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [WantedPanel],
      providers: [
        { provide: I18nService, useValue: spanish() },
        {
          provide: WantedService,
          useValue: {
            items: signal([]).asReadonly(),
            pending: signal([]).asReadonly(),
            acquired: signal([]).asReadonly(),
            loading: signal(false).asReadonly(),
            error: signal('').asReadonly(),
          },
        },
        { provide: ToastService, useValue: { show: () => undefined, error: () => undefined } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(WantedPanel);
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;

    expect(text).toContain(ES['wanted.empty']);
    // The sentence that has to survive translation intact: it is the one that
    // tells somebody the app will not download from Spotify for them.
    expect(text).toContain('Music Hub no descarga de Spotify ni de YouTube');
    expect(text).toContain(ES['link.metadataOnly']);
    expect(text).not.toContain('Nothing on the list yet');
  });

  it('switches an already-rendered screen when the language changes', async () => {
    const i18n = spanish();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [WantedPanel],
      providers: [
        { provide: I18nService, useValue: i18n },
        {
          provide: WantedService,
          useValue: {
            items: signal([]).asReadonly(),
            pending: signal([]).asReadonly(),
            acquired: signal([]).asReadonly(),
            loading: signal(false).asReadonly(),
            error: signal('').asReadonly(),
          },
        },
        { provide: ToastService, useValue: { show: () => undefined, error: () => undefined } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(WantedPanel);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(ES['wanted.empty']);

    // The whole reason the pipe is impure: a switch has to reach strings that
    // are already on screen, not only ones rendered afterwards.
    i18n.use('en');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nothing on the list yet');
    expect(fixture.nativeElement.textContent).not.toContain(ES['wanted.empty']);
  });
});
