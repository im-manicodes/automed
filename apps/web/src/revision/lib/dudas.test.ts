import { anterior, avanzar, construirDudas, flujoInicial, irA, marcar, siguientePendiente, totalGuardadas, totalPendientes } from './dudas';
import type { ApiPage, ApiRegion } from './types';

const reg = (id: string, x: number, y: number, status: ApiRegion['status'] = 'dudoso'): ApiRegion => ({
  id, x, y, w: 0.1, h: 0.05, text: ` ${id}? `, confidence: 0.3, status, textoUsuario: null,
});
const page = (n: number, regions: ApiRegion[]): ApiPage => ({ pageNumber: n, width: 10, height: 10, imageUrl: '', regions });

describe('construirDudas', () => {
  it('ordena por página, luego y, luego x, y omite las no dudosas', () => {
    const d = construirDudas([
      page(2, [reg('c', 0.1, 0.1)]),
      page(1, [reg('b', 0.5, 0.2), reg('a', 0.1, 0.2), reg('z', 0, 0, 'corregido'), reg('first', 0.9, 0.1)]),
    ]);
    expect(d.map((x) => x.id)).toEqual(['first', 'a', 'b', 'c']);
    expect(d[0].sugerencia).toBe('first?');
    expect(d[3].pageNumber).toBe(2);
  });
});

describe('flujo', () => {
  const dudas = construirDudas([page(1, [reg('a', 0, 0.1), reg('b', 0, 0.2), reg('c', 0, 0.3)])]);
  it('avanza saltando guardadas y da la vuelta a omitidas', () => {
    let f = flujoInicial(dudas);
    f = marcar(f, 'a', 'omitida');
    let r = avanzar(f, dudas);
    expect(r.flujo.indice).toBe(1);
    f = marcar(r.flujo, 'b', 'guardada');
    r = avanzar(f, dudas);
    expect(r.flujo.indice).toBe(2);
    f = marcar(r.flujo, 'c', 'guardada');
    r = avanzar(f, dudas);
    expect(r.flujo.indice).toBe(0); // vuelve a la omitida
    expect(totalPendientes(f)).toBe(1);
    expect(totalGuardadas(f)).toBe(2);
  });
  it('termina cuando todo está guardado', () => {
    let f = flujoInicial(dudas);
    for (const d of dudas) f = marcar(f, d.id, 'guardada');
    expect(avanzar(f, dudas).terminado).toBe(true);
    expect(siguientePendiente(f, dudas, 0)).toBeNull();
  });
  it('anterior/irA se limitan a los extremos', () => {
    const f = flujoInicial(dudas);
    expect(anterior(f, dudas).indice).toBe(0);
    expect(irA(f, dudas, 99).indice).toBe(2);
    expect(irA(f, [], 3)).toBe(f);
  });
});
