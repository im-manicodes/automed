import { computeProgress } from './thread-progress';
import { parseStored } from './threads.service';

describe('parseStored (progress:<threadId>)', () => {
  it('acepta modelo (texto corto) y pasada 1|2 solo en etapas de visión', () => {
    expect(
      parseStored({
        etapa: 'vision_procesando',
        regiones: { total: 2, hechas: 1 },
        modelo: 'm',
        pasada: 2,
      }),
    ).toEqual({
      etapa: 'vision_procesando',
      regiones: { total: 2, hechas: 1 },
      modelo: 'm',
      pasada: 2,
    });
    expect(parseStored({ etapa: 'ocr', modelo: 'm', pasada: 1 })).toEqual({
      etapa: 'ocr',
    });
  });

  it('descarta tipos inválidos', () => {
    expect(
      parseStored({
        etapa: 'vision_enviando',
        modelo: 5,
        pasada: 3,
        clave: 'secreta',
      }),
    ).toEqual({ etapa: 'vision_enviando' });
    expect(
      parseStored({ etapa: 'vision_enviando', modelo: 'x'.repeat(500) }),
    ).toEqual({ etapa: 'vision_enviando' });
    expect(parseStored({ etapa: 'otra' })).toBeNull();
    expect(parseStored(null)).toBeNull();
  });
});

const att = (status: string, t?: number, l?: number) => ({
  status,
  paginasTotal: t,
  paginasLeidas: l,
});

describe('computeProgress', () => {
  it('devuelve null si el hilo no está en marcha', () => {
    for (const s of ['sin_analizar', 'listo', 'error'])
      expect(computeProgress({ threadStatus: s, attachments: [] })).toBeNull();
  });

  it('pendiente = en cola 5%', () => {
    const p = computeProgress({
      threadStatus: 'pendiente',
      attachments: [att('pendiente')],
    });
    expect(p).toMatchObject({ etapa: 'en_cola', porcentaje: 5 });
  });

  it('sin adjuntos pasa directo a generar el resumen', () => {
    const p = computeProgress({ threadStatus: 'procesando', attachments: [] });
    expect(p).toMatchObject({
      etapa: 'generando_resumen',
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
    expect(p?.etapa).toBe('escaneando_ocr');
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

  it('todos listos = generando resumen aunque la síntesis ya esté hecha', () => {
    const p = computeProgress({
      threadStatus: 'procesando',
      attachments: [att('listo')],
    });
    expect(p?.etapa).toBe('generando_resumen');
  });

  it('usa la sub-etapa guardada y conserva páginas', () => {
    const base = {
      threadStatus: 'procesando',
      attachments: [att('procesando', 4, 2)],
    };
    const a = computeProgress({
      ...base,
      stored: { etapa: 'vision_enviando', regiones: { total: 3, hechas: 0 } },
    });
    expect(a).toMatchObject({
      etapa: 'ia_dudosas',
      paginas: { total: 4, leidas: 2 },
      regiones: { total: 3, hechas: 0 },
    });
    const b = computeProgress({
      ...base,
      stored: { etapa: 'vision_procesando', regiones: { total: 3, hechas: 1 } },
    });
    expect(b?.etapa).toBe('procesando_dudosas');
    expect(b?.regiones).toEqual({ total: 3, hechas: 1 });
    expect(computeProgress({ ...base, stored: { etapa: 'ocr' } })?.etapa).toBe(
      'escaneando_ocr',
    );
  });

  it('expone modelo y pasada solo en las etapas de dudosas', () => {
    const base = {
      threadStatus: 'procesando',
      attachments: [att('procesando', 4, 2)],
    };
    const p = computeProgress({
      ...base,
      stored: {
        etapa: 'vision_procesando',
        regiones: { total: 4, hechas: 2 },
        modelo: 'gpt-x',
        pasada: 2,
      },
    });
    expect(p).toMatchObject({
      etapa: 'procesando_dudosas',
      modelo: 'gpt-x',
      pasada: 2,
    });
    const e = computeProgress({
      ...base,
      stored: { etapa: 'vision_enviando', modelo: 'gpt-x', pasada: 1 },
    });
    expect(e).toMatchObject({
      etapa: 'ia_dudosas',
      modelo: 'gpt-x',
      pasada: 1,
    });
    const o = computeProgress({
      ...base,
      stored: { etapa: 'ocr', modelo: 'gpt-x', pasada: 1 },
    });
    expect(o).not.toHaveProperty('modelo');
    expect(o).not.toHaveProperty('pasada');
    // sin progreso guardado de visión no hay modelo
    expect(
      computeProgress({ threadStatus: 'pendiente', attachments: [] }),
    ).not.toHaveProperty('modelo');
  });

  it('necesita_revision = revision_manual', () => {
    expect(
      computeProgress({ threadStatus: 'necesita_revision', attachments: [] }),
    ).toMatchObject({ etapa: 'revision_manual' });
  });

  it('listo reciente = resumen_listo 100%; antiguo = null', () => {
    const now = new Date('2026-01-01T00:01:00Z');
    const mk = (updatedAt: Date) =>
      computeProgress({
        threadStatus: 'listo',
        attachments: [att('listo')],
        updatedAt,
        now,
      });
    expect(mk(new Date('2026-01-01T00:00:30Z'))).toMatchObject({
      etapa: 'resumen_listo',
      porcentaje: 100,
    });
    expect(mk(new Date('2026-01-01T00:00:00Z'))).toBeNull();
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
