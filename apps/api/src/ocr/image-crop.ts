import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { OcrBox } from './ocr-engine.interface';

/** Recorta una región (caja normalizada) con margen relativo; devuelve PNG. */
export async function cropRegionPng(
  png: Uint8Array,
  box: OcrBox,
  padding = 0.15,
): Promise<Uint8Array> {
  const img = await loadImage(Buffer.from(png));
  const padX = box.w * padding;
  const padY = Math.max(box.h * padding, 0.005);
  const x0 = Math.max(0, box.x - padX);
  const y0 = Math.max(0, box.y - padY);
  const x1 = Math.min(1, box.x + box.w + padX);
  const y1 = Math.min(1, box.y + box.h + padY);
  const sx = Math.floor(x0 * img.width);
  const sy = Math.floor(y0 * img.height);
  const sw = Math.max(1, Math.ceil((x1 - x0) * img.width));
  const sh = Math.max(1, Math.ceil((y1 - y0) * img.height));
  const canvas = createCanvas(sw, sh);
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toBuffer('image/png');
}

/**
 * Reduce una imagen hasta que pese como máximo `maxBytes`: JPEG calidad 85 y, si hace falta,
 * escalada en pasos de 0.8. Las cajas del OCR son normalizadas, así que el resultado sigue valiendo.
 */
export async function shrinkToJpeg(
  png: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array> {
  const img = await loadImage(Buffer.from(png));
  let scale = 1;
  for (let i = 0; i < 6; i++) {
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toBuffer('image/jpeg', 85);
    if (out.byteLength <= maxBytes) return out;
    scale *= 0.8;
  }
  throw new Error('No se pudo reducir la página al tamaño que acepta Azure');
}
