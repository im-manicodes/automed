import { ajustar, clampTransform, desplazar, dobleToque, enfocarBbox, zoomEn } from './viewport';

const content = { w: 400, h: 600 };
const view = { w: 400, h: 500 };

describe('viewport', () => {
  it('ajustar centra el contenido', () => {
    expect(ajustar(content, { w: 500, h: 600 })).toEqual({ scale: 1, x: 50, y: 0 });
  });
  it('limita la escala', () => {
    expect(clampTransform({ scale: 99, x: 0, y: 0 }, content, view).scale).toBe(6);
    expect(clampTransform({ scale: 0.1, x: 0, y: 0 }, content, view).scale).toBe(1);
  });
  it('zoomEn mantiene fijo el punto bajo el dedo', () => {
    const t0 = ajustar(content, view);
    const t1 = zoomEn(t0, 2, 200, 250, content, view);
    const antes = { x: (200 - t0.x) / t0.scale, y: (250 - t0.y) / t0.scale };
    const despues = { x: (200 - t1.x) / t1.scale, y: (250 - t1.y) / t1.scale };
    expect(despues.x).toBeCloseTo(antes.x);
    expect(despues.y).toBeCloseTo(antes.y);
  });
  it('no deja arrastrar fuera de los bordes', () => {
    const t = zoomEn(ajustar(content, view), 2, 0, 0, content, view);
    const t2 = desplazar(t, 5000, 5000, content, view);
    expect(t2.x).toBe(0);
    expect(t2.y).toBe(0);
    const t3 = desplazar(t, -5000, -5000, content, view);
    expect(t3.x).toBe(view.w - content.w * 2);
    expect(t3.y).toBe(view.h - content.h * 2);
  });
  it('doble toque alterna zoom y ajuste', () => {
    const t0 = ajustar(content, view);
    const t1 = dobleToque(t0, 100, 100, content, view);
    expect(t1.scale).toBeGreaterThan(1);
    expect(dobleToque(t1, 100, 100, content, view).scale).toBe(1);
  });
  it('enfocarBbox centra la caja', () => {
    const bbox = { x: 0.4, y: 0.4, w: 0.2, h: 0.1 };
    const t = enfocarBbox(bbox, content, view, 2);
    const cx = (0.5 * content.w * t.scale) + t.x;
    expect(cx).toBeCloseTo(view.w / 2);
  });
});
