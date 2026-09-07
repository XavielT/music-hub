import { shrinkCover } from './tags';

// Cover art out of a tag is routinely 1500x1500 and over a megabyte, which is
// a real cost on a shared 1 GB bucket and on every device that fetches it.
// These check the shrinking without asserting anything about the encoder's
// exact output.

async function imageBlob(width: number, height: number, type = 'image/png'): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  // Noise, so the encoder cannot compress it to almost nothing and make the
  // size assertions meaningless.
  const image = context.createImageData(width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = (i * 7) % 255;
    image.data[i + 1] = (i * 13) % 255;
    image.data[i + 2] = (i * 29) % 255;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), type));
}

async function sizeOf(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

describe('shrinkCover', () => {
  it('brings an oversized cover down to 512 on its longest edge', async () => {
    const original = await imageBlob(1500, 1500);

    const shrunk = await shrinkCover(original);

    expect(await sizeOf(shrunk)).toEqual({ width: 512, height: 512 });
    expect(shrunk.size).toBeLessThan(original.size);
    expect(shrunk.type).toBe('image/jpeg');
  });

  it('keeps the aspect ratio of a non-square cover', async () => {
    const shrunk = await shrinkCover(await imageBlob(1200, 600));

    const { width, height } = await sizeOf(shrunk);
    expect(width).toBe(512);
    expect(height).toBe(256);
  });

  it('leaves a small cover alone rather than re-encoding it bigger', async () => {
    // A 64x64 PNG is already tiny; a JPEG of it can easily be larger.
    const original = await imageBlob(64, 64);

    const result = await shrinkCover(original);

    expect(result.size).toBeLessThanOrEqual(original.size);
    expect(await sizeOf(result)).toEqual({ width: 64, height: 64 });
  });

  it('hands back the original when the bytes are not an image', async () => {
    // Parsing must never be able to stop a song being added.
    const notAnImage = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });

    const result = await shrinkCover(notAnImage);

    expect(result).toBe(notAnImage);
  });
});
