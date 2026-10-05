import { createCanvas } from '@napi-rs/canvas';
import type { DemoPage } from './demo-data';

/** Dibuja una página PNG FICTICIA con las líneas de texto en las mismas cajas que las regiones OCR. */
export function renderDemoPage(page: DemoPage): Buffer {
  const { width, height } = page;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#9ca3af';
  ctx.font = '22px sans-serif';
  ctx.fillText(
    `DOCUMENTO DEMO FICTICIO · página ${page.pageNumber}`,
    0.08 * width,
    0.05 * height,
  );
  ctx.textBaseline = 'middle';
  for (const l of page.lines) {
    const px = Math.round(l.h * height * 0.7);
    ctx.font = `${l.status === 'ok' ? '' : 'italic '}${px}px sans-serif`;
    ctx.fillStyle = l.status === 'ok' ? '#111827' : '#374151';
    ctx.fillText(
      l.text,
      l.x * width + 4,
      (l.y + l.h / 2) * height,
      l.w * width,
    );
  }
  return canvas.toBuffer('image/png');
}
