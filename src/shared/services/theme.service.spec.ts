import {
  ThemeService,
  ACCENT_PRESETS,
  bestTextOn,
  contrast,
  normaliseHex,
  shade,
  toRgb,
  DEFAULT_ACCENT,
  luminance,
} from './theme.service';

// The picker lets people choose anything, including colours that would make
// every button in the app unreadable. These pin down the parts that stop that.

describe('accent parsing', () => {
  it('accepts both hex shapes and normalises them', () => {
    expect(normaliseHex('#ABC')).toBe('#aabbcc');
    expect(normaliseHex('#FF9000')).toBe('#ff9000');
    expect(normaliseHex('  #ff9000  ')).toBe('#ff9000');
  });

  it('rejects anything that is not a hex colour', () => {
    // A stray value out of storage must not be painted onto the app.
    for (const bad of ['', 'red', 'rgb(1,2,3)', '#12', '#1234567', 'javascript:x']) {
      expect(normaliseHex(bad)).toBeNull();
    }
  });

  it('reads channels in the right order', () => {
    expect(toRgb('#ff9000')).toEqual([255, 144, 0]);
  });
});

describe('accent contrast', () => {
  it('puts black text on light accents and white on dark ones', () => {
    expect(bestTextOn('#ff9000')).toBe('#000000'); // amber
    expect(bestTextOn('#8bc34a')).toBe('#000000'); // lime
    expect(bestTextOn('#1a1a6e')).toBe('#ffffff'); // navy
    expect(bestTextOn('#000000')).toBe('#ffffff');
    expect(bestTextOn('#ffffff')).toBe('#000000');
  });

  it('gives every preset readable text, not merely a defensible one', () => {
    // 4.5:1 is the WCAG AA floor for body text. Every preset should clear it
    // comfortably, or the picker is offering colours that hurt to read.
    for (const preset of ACCENT_PRESETS) {
      const chosen = bestTextOn(preset.value) === '#000000' ? 0 : 1;
      const ratio = contrast(luminance(toRgb(preset.value)), chosen);
      expect(ratio)
        .withContext(`${preset.name} (${preset.value}) contrast`)
        .toBeGreaterThan(4.5);
    }
  });

  it('picks the better of the two rather than just a passable one', () => {
    // The case the old luminance threshold got wrong.
    for (const mid of ['#ff5a3c', '#ff4d7e', '#a970ff', '#5b8cff']) {
      const l = luminance(toRgb(mid));
      expect(contrast(l, 0)).toBeGreaterThan(contrast(l, 1));
      expect(bestTextOn(mid)).toBe('#000000');
    }
  });

  it('darkens and lightens without leaving the range', () => {
    expect(shade('#ffffff', -1)).toBe('#000000');
    expect(shade('#000000', 1)).toBe('#ffffff');
    expect(shade('#ff9000', -0.14)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('ThemeService', () => {
  beforeEach(() => localStorage.removeItem('music-hub.accent'));
  afterEach(() => {
    localStorage.removeItem('music-hub.accent');
    // Leave the document as it was found.
    for (const name of ['--Hub', '--Hub-translucid', '--primary', '--on-Hub']) {
      document.documentElement.style.removeProperty(name);
    }
  });

  const readVar = (name: string) => document.documentElement.style.getPropertyValue(name).trim();

  it('paints every derived token, not just the accent', () => {
    const theme = new ThemeService();
    theme.set('#29b6f6');

    expect(readVar('--Hub')).toBe('#29b6f6');
    expect(readVar('--Hub-translucid')).toBe('rgba(41, 182, 246, 0.35)');
    expect(readVar('--primary')).toMatch(/^#[0-9a-f]{6}$/);
    expect(readVar('--on-Hub')).toBe('#000000');
  });

  it('flips the on-accent text to white for a dark pick', () => {
    const theme = new ThemeService();
    theme.set('#2a1a5e');
    expect(readVar('--on-Hub')).toBe('#ffffff');
  });

  it('remembers the choice and restores it', () => {
    new ThemeService().set('#a970ff');
    expect(new ThemeService().accent()).toBe('#a970ff');
  });

  it('falls back to the default when storage holds nonsense', () => {
    localStorage.setItem('music-hub.accent', 'not-a-colour');
    const theme = new ThemeService();
    expect(theme.accent()).toBe(DEFAULT_ACCENT);
    expect(theme.isDefault()).toBe(true);
  });

  it('ignores an invalid colour rather than painting it', () => {
    const theme = new ThemeService();
    theme.set('#5b8cff');
    theme.set('nonsense');
    expect(theme.accent()).toBe('#5b8cff');
  });
});
