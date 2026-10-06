/** Transformación del visor: la página se muestra a tamaño base (ajustada) multiplicado por `scale`. */
export interface Transform {
  scale: number;
  /** Desplazamiento en px de la esquina superior izquierda del contenido. */
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export const ESCALA_MIN = 1;
export const ESCALA_MAX = 6;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Limita escala y desplazamiento: el contenido no se sale del visor y se centra si es más chico. */
export function clampTransform(t: Transform, content: Size, view: Size): Transform {
  const scale = clamp(t.scale, ESCALA_MIN, ESCALA_MAX);
  const cw = content.w * scale;
  const ch = content.h * scale;
  const x = cw <= view.w ? (view.w - cw) / 2 : clamp(t.x, view.w - cw, 0);
  const y = ch <= view.h ? (view.h - ch) / 2 : clamp(t.y, view.h - ch, 0);
  return { scale, x, y };
}

/** Ajustar a pantalla: escala 1 y centrado. */
export function ajustar(content: Size, view: Size): Transform {
  return clampTransform({ scale: 1, x: 0, y: 0 }, content, view);
}

/** Cambia la escala manteniendo fijo el punto (px,py) del visor. */
export function zoomEn(t: Transform, nuevaEscala: number, px: number, py: number, content: Size, view: Size): Transform {
  const scale = clamp(nuevaEscala, ESCALA_MIN, ESCALA_MAX);
  const k = scale / t.scale;
  return clampTransform({ scale, x: px - (px - t.x) * k, y: py - (py - t.y) * k }, content, view);
}

export function desplazar(t: Transform, dx: number, dy: number, content: Size, view: Size): Transform {
  return clampTransform({ ...t, x: t.x + dx, y: t.y + dy }, content, view);
}

export function distancia(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function punto_medio(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Doble toque: si ya hay zoom vuelve a ajustar; si no, acerca a 2.5x en el punto tocado. */
export function dobleToque(t: Transform, px: number, py: number, content: Size, view: Size): Transform {
  return t.scale > 1.05 ? ajustar(content, view) : zoomEn(t, 2.5, px, py, content, view);
}

/** Centra (y acerca) una caja normalizada de la página en el visor. */
export function enfocarBbox(
  bbox: { x: number; y: number; w: number; h: number },
  content: Size,
  view: Size,
  escalaDeseada = 2.5,
): Transform {
  const scale = clamp(escalaDeseada, ESCALA_MIN, ESCALA_MAX);
  const cx = (bbox.x + bbox.w / 2) * content.w * scale;
  const cy = (bbox.y + bbox.h / 2) * content.h * scale;
  return clampTransform({ scale, x: view.w / 2 - cx, y: view.h / 2 - cy }, content, view);
}

/** Factor de zoom para un evento de rueda (>1 acerca). Normaliza líneas/páginas a píxeles y suaviza trackpads. */
export function factorRueda(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const limitado = Math.max(-120, Math.min(120, px));
  return Math.exp(-limitado * 0.0015);
}

/** Tamaño de un contenido de proporción w:h ajustado (contain) dentro del visor. */
export function ajustarTamano(contenido: Size, view: Size): Size {
  if (contenido.w <= 0 || contenido.h <= 0) return { w: 1, h: 1 };
  const k = Math.min(view.w / contenido.w, view.h / contenido.h);
  return { w: Math.max(1, contenido.w * k), h: Math.max(1, contenido.h * k) };
}

/** Alterna entre ajustar y acercar a `escala` en (px,py); útil con doble clic de ratón. */
export function alternarZoom(t: Transform, px: number, py: number, content: Size, view: Size, escala = 3): Transform {
  return t.scale > 1.05 ? ajustar(content, view) : zoomEn(t, escala, px, py, content, view);
}
