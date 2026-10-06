import { computeProgress } from './thread-progress';

const att = (status: string, t?: number, l?: number) => ({
  status,
  paginasTotal: t,
  paginasLeidas: l,
});

describe('computeProgress', () => {
  it('devuelve null si el hilo no está en marcha', () => {
    for (const s of ['sin_analizar', 'listo', 'error', 'necesita_revision'])
      expect(computeProgress({ threadStatus: s, attachments: [] })).toBeNull();
  });

  it('pendiente = en cola 5%', () => {
    const p = computeProgress({
      threadStatus: 'pendiente',
      attachments: [att('pendiente')],
    });
    expect(p).toMatchObject({ etapa: 'en_cola', porcentaje: 5 });
  });

  it('sin adjuntos pasa directo a escribir el resumen', () => {
    const p = computeProgress({ threadStatus: 'procesando', attachments: [] });
    expect(p).toMatchObject({
      etapa: 'escribiendo_resumen',
      porcentaje: 80,
      adjuntos: { total: 0, listos: 0 },
    });
  });

  it('lee PDFs proporcional a los adjuntos listos', () => {
    const p = computeProgress({
      threadStatus: 'procesando',
      attachments: [
        att('listo'),
        att('procesando'),
        att('pendiente'),
        att('pendiente'),
      ],
    });
    expect(p?.etapa).toBe('leyendo_pdfs');
    expect(p?.adjuntos).toEqual({ total: 4, listos: 1 });
    expect(p?.porcentaje).toBe(24); // 5 + 75 * 1/4
    expect(p?.paginas).toBeUndefined();
  });

  it('afina con páginas leídas', () => {
    const p = computeProgress({
      threadStatus: 'procesando',
      attachments: [att('listo'), att('procesando', 4, 2)],
    });
    expect(p?.paginas).toEqual({ total: 4, leidas: 2 });
    expect(p?.porcentaje).toBe(Math.round(5 + 75 * 0.75));
  });

  it('nunca llega a 80 mientras lee', () => {
    const p = computeProgress({
      threadStatus: 'procesando',
      attachments: [att('listo'), att('procesando', 3, 3)],
    });
    expect(p?.porcentaje).toBeLessThan(80);
  });

  it('todos listos = escribiendo resumen; con síntesis hecha = terminando', () => {
    const base = { threadStatus: 'procesando', attachments: [att('listo')] };
    expect(computeProgress(base)?.etapa).toBe('escribiendo_resumen');
    const p = computeProgress({
      ...base,
      jobs: [
        {
          type: 'synthesize_thread',
          status: 'listo',
          attempts: 1,
          maxAttempts: 5,
          lastError: null,
        },
      ],
    });
    expect(p).toMatchObject({ etapa: 'terminando', porcentaje: 95 });
  });

  it('informa reintento solo con intentos > 1 y error previo, sin exponer el error', () => {
    const p = computeProgress({
      threadStatus: 'procesando',
      attachments: [att('procesando')],
      jobs: [
        {
          type: 'process_attachment',
          status: 'pendiente',
          attempts: 2,
          maxAttempts: 5,
          lastError: 'secreto',
        },
        {
          type: 'process_attachment',
          status: 'procesando',
          attempts: 1,
          maxAttempts: 5,
          lastError: null,
        },
      ],
    });
    expect(p?.reintento).toEqual({ intento: 2, maximo: 5 });
    expect(JSON.stringify(p)).not.toContain('secreto');
  });
});
