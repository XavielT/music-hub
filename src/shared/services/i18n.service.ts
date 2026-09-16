import { Injectable, computed, signal } from '@angular/core';
import type { TranslationKey } from '../i18n/en';

export type Lang = 'es' | 'en';

type Dictionary = Record<TranslationKey, string>;

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

const STORAGE_KEY = 'music-hub.lang';

// Each dictionary is its own chunk. `import type` above matters as much as
// these do: a value import of TranslationKey would pull en.ts back into the
// main bundle and undo the split. es.ts imports the type the same way.
const LOADERS: Record<Lang, () => Promise<Dictionary>> = {
  en: () => import('../i18n/en').then(m => m.EN),
  es: () => import('../i18n/es').then(m => m.ES),
};

// Module-level, so the second component to ask for a language it already has
// does not fetch it again, and so tests can warm it once per suite.
const loaded = new Map<Lang, Dictionary>();
const inFlight = new Map<Lang, Promise<Dictionary>>();

function ensure(lang: Lang): Promise<Dictionary> {
  const have = loaded.get(lang);
  if (have) return Promise.resolve(have);

  // Without this, a language switch mid-load starts a second import of the
  // same chunk.
  const running = inFlight.get(lang);
  if (running) return running;

  const load = LOADERS[lang]()
    .then(dict => {
      loaded.set(lang, dict);
      return dict;
    })
    .finally(() => inFlight.delete(lang));

  inFlight.set(lang, load);
  return load;
}

export function isLang(value: unknown): value is Lang {
  return value === 'es' || value === 'en';
}

/**
 * Runtime translation for the whole UI.
 *
 * Each dictionary is a lazy chunk, loaded on demand.
 *
 * This used to import both statically, on the reasoning that two dictionaries
 * "cost a handful of KB next to a 600 KB bundle". They had grown to 71 KB by the
 * time the i18n work finished, which pushed the initial bundle 34 KB past its
 * budget — so the premise stopped being true, not the reasoning.
 *
 * The two things that argument was protecting are both still protected, which is
 * why the split is safe:
 *
 *  - *No async gap at first paint.* `init()` is awaited by provideAppInitializer,
 *    so the active dictionary is in memory before Angular bootstraps. Nobody ever
 *    sees a screen of raw keys.
 *  - *Still right offline.* ngsw-config's "app" asset group prefetches `/*.js`,
 *    which already covers emitted lazy chunks. No service-worker change was
 *    needed, and the second launch reads the same as the first.
 *
 * A language switch awaits its dictionary before flipping `lang`, so the UI never
 * renders half-translated and the pipe's cache never holds a stale answer.
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

  // Bumped when a dictionary finishes loading. t() reads it so that anything
  // rendered through the pipe recomputes once the words are actually there.
  private _loadedAt = signal(0);

  constructor() {
    // The device's last choice is the best guess available before any profile
    // has loaded, so the auth screen is already in the right language. Setting
    // the language is synchronous; fetching its words is not, which is what
    // init() below is for.
    const stored = this.stored();
    if (stored) {
      this.apply(stored);
      this._chosen.set(true);
    } else {
      this.apply(browserLanguage());
    }
  }

  /**
   * Load the active dictionary. Awaited by provideAppInitializer, so bootstrap
   * does not finish until the first screen has words to render.
   */
  async init(): Promise<void> {
    try {
      await ensure(this._lang());
    } catch (err) {
      // A dictionary is a lazy chunk now, so this is a failed network request:
      // an old service worker pointing at a hash that no longer exists, or a
      // phone that lost the connection between index.html and the chunk. One
      // retry covers the second case, which is the common one.
      console.warn('dictionary load failed, retrying', err);
      try {
        await ensure(this._lang());
      } catch {
        // Deliberately not fatal. app.config wraps initializers so a rejection
        // here cannot stop the app opening, and t() answers with the key
        // itself when it has no dictionary — a screen of terse English labels,
        // which is a great deal better than no screen at all.
        console.warn('dictionary unavailable; falling back to keys');
      }
    }
    this._loadedAt.set(this._loadedAt() + 1);
  }

  /**
   * Warm a dictionary without an instance. Tests use it so they can keep
   * asserting rendered prose synchronously — one `beforeAll` instead of making
   * every spec async.
   */
  static async preload(lang: Lang): Promise<void> {
    await ensure(lang);
  }

  /**
   * Translate. Unknown keys come back as themselves, which is what makes it
   * safe to pass a message that is already a sentence — a server error the app
   * did not write, say — through the same call as a real key.
   */
  t(key: TranslationKey | string, params?: Record<string, string | number>): string {
    // Read so a component using the pipe re-renders when a dictionary lands.
    this._loadedAt();
    const dict = loaded.get(this._lang()) as Record<string, string> | undefined;
    const fallback = loaded.get('en') as Record<string, string> | undefined;
    let text = dict?.[key] ?? fallback?.[key] ?? key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  }

  /**
   * A deliberate choice by the user: applied, remembered on this device.
   *
   * The dictionary is awaited before the language flips, so the screen changes
   * in one step rather than blanking into keys and filling back in.
   */
  use(lang: Lang): Promise<void> {
    return this.switchTo(lang, () => {
      this._chosen.set(true);
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        // Private mode: the choice lasts for this session, and the profile copy
        // still carries it to the next one.
      }
    });
  }

  /**
   * The language stored on the profile, which outranks the device because it is
   * what follows the user to another browser. Ignored when it is null — that
   * means the account never chose, not that it chose English.
   */
  applyRemote(lang: string | null | undefined): Promise<void> {
    if (!isLang(lang)) return Promise.resolve();
    return this.switchTo(lang, () => {
      this._chosen.set(true);
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        /* storage unavailable — the profile is still the source of truth */
      }
    });
  }

  /**
   * The library's default, from app_settings. Lowest priority of the real
   * inputs: it only decides for somebody who has never chosen anywhere.
   */
  applyDefault(lang: string | null | undefined): Promise<void> {
    if (this._chosen() || !isLang(lang)) return Promise.resolve();
    // The _chosen re-check inside switchTo matters here: when the dictionary is
    // not yet cached a real choice may arrive while the chunk is in flight, and
    // the library default must not overrule it.
    return this.switchTo(lang, undefined, () => !this._chosen());
  }

  /**
   * Flip to a language once its words are available.
   *
   * Synchronous when the dictionary is already in memory — which it is for the
   * active language after `init()`, and for the other one after it has been
   * shown once. That matters: an await here would push every language switch a
   * microtask into the future for no reason, and callers that read `lang()` on
   * the next line would read the old value.
   */
  private switchTo(lang: Lang, after?: () => void, stillWanted?: () => boolean): Promise<void> {
    const commit = () => {
      if (stillWanted && !stillWanted()) return;
      this.apply(lang);
      after?.();
    };

    if (loaded.has(lang)) {
      commit();
      return Promise.resolve();
    }
    return ensure(lang).then(() => {
      this._loadedAt.set(this._loadedAt() + 1);
      commit();
    });
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
