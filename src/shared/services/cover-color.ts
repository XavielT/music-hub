import { contrast, luminance, toRgb } from './theme.service';

// Sampling grid. The point is the *mood* of a cover, not its detail, so a
// handful of pixels is plenty and a small canvas keeps this off the main
// thread's conscience.
const SAMPLE_SIZE = 24;
// 5 bits per channel: enough buckets to keep a red apart from an orange,
// coarse enough that a gradient counts as one colour rather than four hundred.
const BUCKET_SHIFT = 3;
// White text has to stay readable on whatever comes back.
const MIN_CONTRAST_ON_TINT = 4.5;

/**
 * The colour a cover "is", from its raw pixels.
 *
 * Not an average: averaging a cover gives mud, because the mean of a red and a
 * green is grey. Pixels are dropped into coarse buckets, the fullest bucket
 * wins, and the exact pixels in it are then averaged — so the answer is a real
 * colour from the artwork rather than a blend of everything in it.
 *
 * Near-black and near-white pixels are ignored first. Sleeve borders, letter-
 * boxing and plain backgrounds are usually one of the two, and they are almost
 * never what someone would call the colour of the cover.
 */
export function dominantColor(pixels: Uint8ClampedArray): string | null {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();

  for (let i = 0; i < pixels.length; i += 4) {
    // Fully transparent pixels are not part of the picture.
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 24 || min > 232) continue; // near-black, near-white

    const key =
      ((r >> BUCKET_SHIFT) << 10) | ((g >> BUCKET_SHIFT) << 5) | (b >> BUCKET_SHIFT);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n++;
    buckets.set(key, bucket);
  }

  let best: { r: number; g: number; b: number; n: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.n > best.n) best = bucket;
  }
  if (!best) return null;

  return hex(
    Math.round(best.r / best.n),
    Math.round(best.g / best.n),
    Math.round(best.b / best.n)
  );
}

/**
 * The same colour, darkened until white text on it is comfortable.
 *
 * A cover can be any colour at all, including a pale yellow that would leave
 * the song title invisible. Rather than give up and use grey, the hue is kept
 * and the lightness taken down until it clears WCAG AA — so a lemon sleeve
 * still tints the player, just as a deep amber.
 */
export function tintForDarkUi(color: string): string {
  let current = toRgb(color);
  // 24 steps of 8% is enough to take pure white down past the threshold.
  for (let step = 0; step < 24; step++) {
    if (contrast(luminance(current), 1) >= MIN_CONTRAST_ON_TINT) break;
    current = current.map(v => Math.round(v * 0.92)) as [number, number, number];
  }
  return hex(current[0], current[1], current[2]);
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Loads an image and reads its dominant colour, already darkened for the
 * player's white text. Returns null for anything that will not load or will
 * not sample — a cross-origin image taints the canvas and throws on read.
 */
export async function coverTint(url: string): Promise<string | null> {
  const pixels = await samplePixels(url);
  if (!pixels) return null;
  const colour = dominantColor(pixels);
  return colour ? tintForDarkUi(colour) : null;
}

function samplePixels(url: string): Promise<Uint8ClampedArray | null> {
  return new Promise(resolve => {
    const image = new Image();
    // Artwork is an object URL from IndexedDB in the normal case, which is
    // same-origin; this only matters for a cover that came straight from a URL.
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        resolve(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
      } catch {
        // Tainted canvas, or no 2d context at all.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
