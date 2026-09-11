import { Injectable, computed, signal } from '@angular/core';
import { EN, TranslationKey } from '../i18n/en';
import { ES } from '../i18n/es';

export type Lang = 'es' | 'en';

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

const STORAGE_KEY = 'music-hub.lang';

const DICTIONARIES: Record<Lang, Record<TranslationKey, string>> = { en: EN, es: ES };

export function isLang(value: unknown): value is Lang {
  return value === 'es' || value === 'en';
}

/**
 * Runtime translation for the whole UI.
 *
 * Both dictionaries are imported statically rather than fetched. Two languages
 * of a few hundred short strings cost a handful of KB next to a 600 KB bundle,
 * and paying that buys the two things lazy JSON would have cost: no async gap
 * where the first paint shows keys instead of words, and nothing extra to teach
 * the service worker so it still reads right offline on the second launch.
 *
 * The service deliberately knows nothing about auth or Supabase. AuthService
 * pushes the profile's language in through `applyRemote()` once it loads, which
 * keeps the dependency pointing one way — services that emit user-facing text
 * inject this one, and it injects none of them.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private _lang = signal<Lang>('en');
  lang = this._lang.asReadonly();

  // True once a real choice (profile or device) has been found, as opposed to
  // the library default or the browser's guess. The welcome box asks the
  // question only when nobody has answered it yet.
  private _chosen = signal(false);
  chosen = this._chosen.asReadonly();

  label = computed(() => LANGUAGES.find(l => l.value === this._lang())?.label ?? 'English');

  constructor() {
    // The device's last choice is the best guess available before any profile
    // has loaded, so the auth screen is already in the right language.
    const stored = this.stored();
    if (stored) {
      this.apply(stored);
      this._chosen.set(true);
    } else {
      this.apply(browserLanguage());
    }
  }

  /**
   * Translate. Unknown keys come back as themselves, which is what makes it
   * safe to pass a message that is already a sentence — a server error the app
   * did not write, say — through the same call as a real key.
   */
  t(key: TranslationKey | string, params?: Record<string, string | number>): string {
    const dict = DICTIONARIES[this._lang()];
    let text = (dict as Record<string, string>)[key] ?? (EN as Record<string, string>)[key] ?? key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  }

  /** A deliberate choice by the user: applied, remembered on this device. */
  use(lang: Lang): void {
    this.apply(lang);
    this._chosen.set(true);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Private mode: the choice lasts for this session, and the profile copy
      // still carries it to the next one.
    }
  }

  /**
   * The language stored on the profile, which outranks the device because it is
   * what follows the user to another browser. Ignored when it is null — that
   * means the account never chose, not that it chose English.
   */
  applyRemote(lang: string | null | undefined): void {
    if (!isLang(lang)) return;
    this.apply(lang);
    this._chosen.set(true);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage unavailable — the profile is still the source of truth */
    }
  }

  /**
   * The library's default, from app_settings. Lowest priority of the real
   * inputs: it only decides for somebody who has never chosen anywhere.
   */
  applyDefault(lang: string | null | undefined): void {
    if (this._chosen() || !isLang(lang)) return;
    this.apply(lang);
  }

  private apply(lang: Lang): void {
    this._lang.set(lang);
    // Keeps the document honest for screen readers and for the browser's own
    // translate prompt, which otherwise offers to translate a page that just
    // translated itself.
    try {
      document.documentElement.lang = lang;
    } catch {
      /* no document (tests) */
    }
  }

  private stored(): Lang | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return isLang(raw) ? raw : null;
    } catch {
      return null;
    }
  }
}

// 'es-419', 'es-ES' and plain 'es' all mean Spanish here; everything else falls
// to English rather than guessing at a third language the app does not have.
function browserLanguage(): Lang {
  try {
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of tags) {
      if (typeof tag === 'string' && tag.toLowerCase().startsWith('es')) return 'es';
    }
  } catch {
    /* no navigator (tests) */
  }
  return 'en';
}
