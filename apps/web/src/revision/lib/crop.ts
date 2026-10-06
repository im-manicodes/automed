import type { Bbox } from './types';

export interface PixelRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Rectángulo en píxeles de la imagen a recortar: la bbox normalizada [0..1]
 * más un margen de contexto (fracción del propio tamaño de la caja, con un
 * mínimo en píxeles), limitado a los bordes de la imagen.
 */
export function cropRect(
  bbox: Bbox,
  imgW: number,
  imgH: number,
  opts: { margenRel?: number; margenMinPx?: number } = {},
): PixelRect {
  const { margenRel = 0.6, margenMinPx = 24 } = opts;
  const bx = clamp(bbox.x, 0, 1) * imgW;
  const by = clamp(bbox.y, 0, 1) * imgH;
  const bw = clamp(bbox.w, 0, 1) * imgW;
  const bh = clamp(bbox.h, 0, 1) * imgH;
  const mx = Math.max(margenMinPx, bw * margenRel);
  const my = Math.max(margenMinPx, bh * margenRel);
  const x0 = clamp(bx - mx, 0, imgW);
  const y0 = clamp(by - my, 0, imgH);
  const x1 = clamp(bx + bw + mx, 0, imgW);
  const y1 = clamp(by + bh + my, 0, imgH);
  return { sx: x0, sy: y0, sw: Math.max(1, x1 - x0), sh: Math.max(1, y1 - y0) };
}

/** Posición de la bbox dentro del recorte, en fracciones [0..1] del recorte (para el recuadro). */
export function bboxEnRecorte(bbox: Bbox, imgW: number, imgH: number, rect: PixelRect): Bbox {
  return {
    x: (bbox.x * imgW - rect.sx) / rect.sw,
    y: (bbox.y * imgH - rect.sy) / rect.sh,
    w: (bbox.w * imgW) / rect.sw,
    h: (bbox.h * imgH) / rect.sh,
  };
}

/** Tamaño del canvas de salida: ajusta el recorte al ancho disponible sin pasar de un alto máximo. */
export function tamanoSalida(
  rect: PixelRect,
  anchoDisponible: number,
  altoMax: number,
  dpr = 1,
): { width: number; height: number } {
  const escala = Math.min(anchoDisponible / rect.sw, altoMax / rect.sh);
  return {
    width: Math.max(1, Math.round(rect.sw * escala * dpr)),
    height: Math.max(1, Math.round(rect.sh * escala * dpr)),
  };
}

/**
 * Posición (en % del contenedor del recorte) de la imagen completa para que, dentro de un
 * contenedor con overflow oculto y la proporción del recorte, solo se vea `rect`.
 * Así el navegador pinta la imagen a su resolución natural al hacer zoom con CSS.
 */
export function estiloImagenEnRecorte(rect: PixelRect, imgW: number, imgH: number) {
  return {
    left: -(rect.sx / rect.sw) * 100,
    top: -(rect.sy / rect.sh) * 100,
    width: (imgW / rect.sw) * 100,
    height: (imgH / rect.sh) * 100,
  };
}
