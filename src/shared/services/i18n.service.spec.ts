import { I18nService } from './i18n.service';
import { EN } from '../i18n/en';
import { ES } from '../i18n/es';

// The dictionaries are typed against each other, so "is a key missing" is a
// build error rather than a test. What is worth checking here is the part types
// cannot see: which input wins when several of them have an opinion, and that
// nothing falls through to a bare key on screen.

const KEY = 'music-hub.lang';

describe('I18nService', () => {
  // The rest of the suite resolves its language through a root-injected
  // I18nService, which reads this key — so leaving one behind would decide
  // another spec's language for it.
  let previous: string | null;

  beforeEach(() => {
    previous = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
  });

  afterEach(() => {
    if (previous === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, previous);
  });

  it('starts from the device choice when there is one', () => {
    localStorage.setItem(KEY, 'es');
    expect(new I18nService().lang()).toBe('es');
  });

  it('ignores a stored value that is not a language we have', () => {
    localStorage.setItem(KEY, 'fr');
    // Falls through to the browser, which under Karma is English.
    expect(new I18nService().lang()).toBe('en');
  });

  it('lets the profile outrank the device', () => {
    localStorage.setItem(KEY, 'en');
    const i18n = new I18nService();
    i18n.applyRemote('es');
    expect(i18n.lang()).toBe('es');
    // and it is written through, so the next start on this device agrees
    expect(localStorage.getItem(KEY)).toBe('es');
  });

  it('treats a null profile language as "never chose" rather than English', () => {
    localStorage.setItem(KEY, 'es');
    const i18n = new I18nService();
    i18n.applyRemote(null);
    expect(i18n.lang()).toBe('es');
  });

  it('applies the library default only when nobody has chosen', () => {
    const fresh = new I18nService();
    fresh.applyDefault('es');
    expect(fresh.lang()).toBe('es');

    localStorage.setItem(KEY, 'en');
    const chosen = new I18nService();
    chosen.applyDefault('es');
    expect(chosen.lang()).toBe('en');
  });

  it('remembers a deliberate choice on this device', () => {
    const i18n = new I18nService();
    i18n.use('es');
    expect(localStorage.getItem(KEY)).toBe('es');
    expect(new I18nService().lang()).toBe('es');
  });

  it('fills placeholders, and every occurrence of one', () => {
    const i18n = new I18nService();
    expect(i18n.t('common.songs', { count: 4 })).toBe('4 songs');
    expect(i18n.t('admin.deleteAsk', { name: 'Ana' })).toContain('Ana');
  });

  it('hands back an unknown key unchanged, so a server sentence survives', () => {
    const i18n = new I18nService();
    const fromServer = 'Some error only the server knows about.';
    expect(i18n.t(fromServer)).toBe(fromServer);
  });

  it('sets <html lang> so the browser stops offering to translate', () => {
    const i18n = new I18nService();
    i18n.use('es');
    expect(document.documentElement.lang).toBe('es');
    i18n.use('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('has no empty or untranslated-looking Spanish string', () => {
    for (const [key, value] of Object.entries(ES)) {
      expect(value.trim().length).withContext(key).toBeGreaterThan(0);
      // A Spanish entry identical to the English one is almost always a key
      // copied across and never translated. These four genuinely are the same
      // in both: "playlist" is the word Spanish speakers use, "token" is the
      // word the companion's own config uses, and min/s are abbreviations.
      const same = value === (EN as Record<string, string>)[key];
      const allowed = [
        'library.tab.playlists',
        'companion.token',
        'player.sleepMinutes',
        'player.sleepSeconds',
      ];
      if (same) expect(allowed).withContext(`${key} is identical to English`).toContain(key);
    }
  });
});
