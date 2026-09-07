import { Injectable, computed, signal } from '@angular/core';

export interface AccentPreset {
  name: string;
  value: string;
}

// Deliberately a short list of colours that all work on the app's near-black
// ground. A free-for-all picker is still offered, but these are the ones that
// look like a decision rather than an accident.
export const ACCENT_PRESETS: AccentPreset[] = [
  { name: 'Amber', value: '#ff9000' },
  { name: 'Ember', value: '#ff5a3c' },
  { name: 'Rose', value: '#ff4d7e' },
  { name: 'Violet', value: '#a970ff' },
  { name: 'Indigo', value: '#5b8cff' },
  { name: 'Sky', value: '#29b6f6' },
  { name: 'Mint', value: '#20c9a0' },
  { name: 'Lime', value: '#8bc34a' },
];

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].value;
const STORAGE_KEY = 'music-hub.accent';

/**
 * Recolours the app from one accent.
 *
 * Everything visual keys off `--Hub`, so the whole theme is that value plus
 * three derived ones: a translucent version for shadows, a deeper shade, and
 * the text colour that sits *on* the accent — which has to flip to white for a
 * dark pick, or every button reads as black on black.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly presets = ACCENT_PRESETS;

  private _accent = signal(DEFAULT_ACCENT);
  accent = this._accent.asReadonly();

  isDefault = computed(() => this._accent().toLowerCase() === DEFAULT_ACCENT.toLowerCase());

  constructor() {
    this.set(this.restore(), false);
  }

  set(hex: string, persist = true): void {
    const accent = normaliseHex(hex);
    if (!accent) return;
    this._accent.set(accent);
    this.paint(accent);
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, accent);
      } catch {
        // Private mode: the colour lasts for this session only.
      }
    }
  }

  reset(): void {
    this.set(DEFAULT_ACCENT);
  }

  private paint(accent: string): void {
    const [r, g, b] = toRgb(accent);
    const root = document.documentElement.style;
    root.setProperty('--Hub', accent);
    root.setProperty('--Hub-translucid', `rgba(${r}, ${g}, ${b}, 0.35)`);
    // The deeper shade a few places use for secondary emphasis.
    root.setProperty('--primary', shade(accent, -0.14));
    // Text and icons drawn on top of the accent.
    root.setProperty('--on-Hub', bestTextOn(accent));
  }

  private restore(): string {
    try {
      return normaliseHex(localStorage.getItem(STORAGE_KEY) ?? '') ?? DEFAULT_ACCENT;
    } catch {
      return DEFAULT_ACCENT;
    }
  }
}

// --- colour helpers ---

// Accepts #abc and #aabbcc, in any case, and rejects anything else rather than
// painting the app with a stray value out of storage.
export function normaliseHex(input: string): string | null {
  const value = (input || '').trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/.test(value) ? value : null;
}

export function toRgb(hex: string): [number, number, number] {
  const value = normaliseHex(hex) ?? DEFAULT_ACCENT;
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ];
}

// Relative luminance per WCAG, which is what decides black or white on top.
export function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// Contrast ratio between two luminances, per WCAG.
export function contrast(a: number, b: number): number {
  const [lighter, darker] = a >= b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Black or white on top of a colour, whichever is actually more readable.
 *
 * Picking this off a luminance threshold is a guess, and a wrong one: at 0.42
 * the mid-range accents here (Ember, Rose, Violet, Indigo, all around 0.28)
 * would have taken white text at 3.1:1 when black gives them 6.6:1. Comparing
 * the two contrast ratios has no threshold to get wrong.
 */
export function bestTextOn(hex: string): string {
  const l = luminance(toRgb(hex));
  return contrast(l, 0) >= contrast(l, 1) ? '#000000' : '#ffffff';
}

// amount < 0 darkens, > 0 lightens, both towards the limit rather than past it.
export function shade(hex: string, amount: number): string {
  const rgb = toRgb(hex).map(value => {
    const target = amount < 0 ? 0 : 255;
    return Math.round(value + (target - value) * Math.abs(amount));
  });
  return `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
