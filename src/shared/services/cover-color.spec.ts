import { coverTint, dominantColor, tintForDarkUi } from './cover-color';
import { contrast, luminance, toRgb } from './theme.service';

// The two ways this can go wrong are both quiet: an average instead of a
// dominant colour gives every cover the same mud, and a pale cover gives a
// tint that makes the song title unreadable. Both are pinned here.

// Builds raw RGBA for a picture made of solid blocks, in the proportions given.
function pixels(blocks: { color: [number, number, number]; count: number; alpha?: number }[]) {
  const total = blocks.reduce((n, b) => n + b.count, 0);
  const data = new Uint8ClampedArray(total * 4);
  let at = 0;
  for (const block of blocks) {
    for (let i = 0; i < block.count; i++) {
      data[at++] = block.color[0];
      data[at++] = block.color[1];
      data[at++] = block.color[2];
      data[at++] = block.alpha ?? 255;
    }
  }
  return data;
}

// A canvas-drawn PNG, so the whole path — load, draw, read back — is exercised
// rather than just the arithmetic.
function pngDataUrl(fill: string, accent?: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d')!;
  context.fillStyle = fill;
  context.fillRect(0, 0, 32, 32);
  if (accent) {
    context.fillStyle = accent;
    context.fillRect(0, 0, 32, 8);
  }
  return canvas.toDataURL('image/png');
}

describe('dominantColor', () => {
  it('picks the colour most of the cover is, not the average of it', () => {
    // Red and green in equal measure would average to a muddy olive. The
    // answer has to be one of them.
    const data = pixels([
      { color: [200, 30, 30], count: 60 },
      { color: [30, 200, 30], count: 40 },
    ]);
    expect(dominantColor(data)).toBe('#c81e1e');
  });

  it('ignores the black border and the white margin', () => {
    // A sleeve that is mostly black surround with a small teal label: the
    // label is what anyone would call its colour.
    const data = pixels([
      { color: [4, 4, 4], count: 300 },
      { color: [250, 250, 250], count: 120 },
      { color: [0, 150, 136], count: 40 },
    ]);
    expect(dominantColor(data)).toBe('#009688');
  });

  it('averages within the winning bucket, so a gradient is one colour', () => {
    // Three near-identical reds land in one bucket and come back as their
    // mean, rather than splitting the vote three ways and losing to the blue.
    const data = pixels([
      { color: [200, 40, 40], count: 10 },
      { color: [202, 42, 42], count: 10 },
      { color: [204, 44, 44], count: 10 },
      { color: [40, 40, 200], count: 25 },
    ]);
    expect(dominantColor(data)).toBe('#ca2a2a');
  });

  it('skips transparent pixels', () => {
    const data = pixels([
      { color: [255, 0, 0], count: 50, alpha: 0 },
      { color: [0, 0, 255], count: 10 },
    ]);
    expect(dominantColor(data)).toBe('#0000ff');
  });

  it('gives up on a cover with nothing but black and white in it', () => {
    const data = pixels([
      { color: [0, 0, 0], count: 50 },
      { color: [255, 255, 255], count: 50 },
    ]);
    expect(dominantColor(data)).toBeNull();
  });
});

describe('tintForDarkUi', () => {
  it('takes a pale colour down until white text is readable on it', () => {
    const tint = tintForDarkUi('#fff59d'); // pale lemon
    expect(contrast(luminance(toRgb(tint)), 1)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the hue rather than falling back to grey', () => {
    const [r, g, b] = toRgb(tintForDarkUi('#fff59d'));
    // Still yellow: red and green well ahead of blue.
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });

  it('leaves a colour that is already dark enough alone', () => {
    expect(tintForDarkUi('#101820')).toBe('#101820');
  });

  it('handles pure white without giving up', () => {
    const tint = tintForDarkUi('#ffffff');
    expect(contrast(luminance(toRgb(tint)), 1)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('coverTint', () => {
  it('reads a real image and returns something readable', async () => {
    const tint = await coverTint(pngDataUrl('#f0e0a0', '#2266cc'));
    expect(tint).toBeTruthy();
    expect(contrast(luminance(toRgb(tint!)), 1)).toBeGreaterThanOrEqual(4.5);
  });

  it('returns null rather than throwing when the image will not load', async () => {
    expect(await coverTint('data:image/png;base64,notanimage')).toBeNull();
  });
});
