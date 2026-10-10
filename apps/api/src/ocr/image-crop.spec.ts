import { createCanvas } from '@napi-rs/canvas';
import { shrinkToJpeg } from './image-crop';

function gradientPng(size: number): Uint8Array {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < size; y++) {
    ctx.fillStyle = `rgb(${y % 256},${(y * 3) % 256},${(y * 7) % 256})`;
    ctx.fillRect(0, y, size, 1);
    // ruido ligero para que PNG no comprima del todo
    for (let x = 0; x < size; x += 7) {
      ctx.fillStyle = `rgb(${(x * y) % 256},${(x + y) % 256},${(x * 5) % 256})`;
      ctx.fillRect(x, y, 2, 1);
    }
  }
  return canvas.toBuffer('image/png');
}

describe('shrinkToJpeg', () => {
  it('reduce una imagen pesada por debajo del límite y devuelve un JPEG', async () => {
    const png = gradientPng(1200);
    const base = await shrinkToJpeg(png, Number.MAX_SAFE_INTEGER);
    const limit = Math.floor(base.byteLength * 0.7); // obliga a escalar
    const out = await shrinkToJpeg(png, limit);
    expect(out.byteLength).toBeLessThanOrEqual(limit);
    expect(Array.from(out.slice(0, 2))).toEqual([0xff, 0xd8]);
  });

  it('falla con un mensaje claro si no logra reducirla', async () => {
    await expect(shrinkToJpeg(gradientPng(400), 10)).rejects.toThrow(/Azure/);
  });
});
