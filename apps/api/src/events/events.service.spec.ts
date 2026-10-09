import { Logger } from '@nestjs/common';
import { EventsService } from './events.service';
/** Columnas fijas de prueba (independientes del default de la plantilla de reporte). */
const TEST_REPORT_TEMPLATE_MARKDOWN = `- Paciente: Nombre completo del paciente.
- Hospital: Hospital donde está internado.
- Diagnóstico: Diagnóstico en una frase.
`;

const SECRET = 'MARIA-LOPEZ-DIAGNOSTICO-SECRETO';
const MAIL_SECRET = 'CUERPO-DEL-CORREO-SECRETO';

function setup(
  opts: { status?: string; llm?: (p: string) => string | Error } = {},
) {
  const events: any[] = [];
  const thread: any = {
    id: 't1',
    status: opts.status ?? 'listo',
    lastMessageAt: new Date('2026-10-05T20:00:00Z'),
  };
  const syntheses = [
    { id: 's1', version: 1, markdown: 'viejo', coveredMessageIds: ['m1'] },
    {
      id: 's2',
      version: 2,
      markdown: `Resumen vigente ${SECRET}`,
      coveredMessageIds: ['m1', 'm2'],
    },
  ];
  const messages = [
    { id: 'm1', receivedAt: new Date('2026-10-01T10:00:00Z') },
    { id: 'm2', receivedAt: new Date('2026-10-03T10:00:00Z') },
    { id: 'm3', receivedAt: new Date('2026-10-09T10:00:00Z') }, // no cubierto
  ];
  const prisma: any = {
    thread: {
      findUnique: ({ where }: any) =>
        Promise.resolve(where.id === 't1' ? thread : null),
    },
    synthesis: {
      findMany: () => Promise.resolve([syntheses[1]]),
    },
    message: {
      findMany: jest.fn(() => Promise.resolve(messages)),
    },
    hospitalEvent: {
      findMany: ({ where }: any) =>
        Promise.resolve(
          events
            .filter((e) => !where?.threadId || e.threadId === where.threadId)
            .sort((a, b) => b.fechaEvento - a.fechaEvento),
        ),
      findFirst: ({ where }: any) =>
        Promise.resolve(
          events.find(
            (e) =>
              e.threadId === where.threadId &&
              e.synthesisId === where.synthesisId,
          ) ?? null,
        ),
      findUnique: ({ where }: any) =>
        Promise.resolve(events.find((e) => e.id === where.id) ?? null),
      create: jest.fn(({ data }: any) => {
        const dup = events.some(
          (e) =>
            e.threadId === data.threadId && e.synthesisId === data.synthesisId,
        );
        if (dup)
          return Promise.reject(
            Object.assign(new Error('x'), { code: 'P2002' }),
          );
        const row = {
          id: `e${events.length + 1}`,
          createdAt: new Date(),
          ...data,
        };
        events.push(row);
        return Promise.resolve(row);
      }),
      delete: ({ where }: any) => {
        events.splice(
          events.findIndex((e) => e.id === where.id),
          1,
        );
        return Promise.resolve();
      },
    },
  };
  const prompts: string[] = [];
  const generator: any = {
    extract: jest.fn((md: string, _c: any, prev: any) => {
      prompts.push(md + JSON.stringify(prev));
      const r = opts.llm?.(md);
      if (r instanceof Error) return Promise.resolve(null);
      return Promise.resolve({
        estado: 'hospitalizado',
        novedadTexto: 'Mejora',
        data: { Paciente: 'Maria', Hospital: 'H1' },
      });
    }),
  };
  const templates: any = {
    getActive: () =>
      Promise.resolve({
        version: 4,
        markdown: TEST_REPORT_TEMPLATE_MARKDOWN,
      }),
  };
  const reports: any = {
    getSettings: () => Promise.resolve({ zona: 'America/Mexico_City' }),
  };
  const svc = new EventsService(prisma, templates, generator, reports);
  return { svc, prisma, generator, events, thread, prompts, messages };
}

const body = (o: any = {}) => ({
  synthesisId: 's2',
  datos: { Paciente: 'Maria', Hospital: 'H1' },
  estado: 'hospitalizado',
  novedadTexto: 'Mejora',
  fechaEvento: '2026-10-03T10:00:00.000Z',
  ...o,
});

describe('EventsService', () => {
  it('borrador: usa solo la síntesis vigente, no guarda y fecha = último correo cubierto', async () => {
    const h = setup();
    const d = await h.svc.draft('t1');
    expect(h.generator.extract).toHaveBeenCalledTimes(1);
    expect(h.prompts[0]).toContain(SECRET);
    expect(h.prompts[0]).not.toContain('viejo');
    expect(h.prompts[0]).not.toContain(MAIL_SECRET);
    expect(h.prisma.hospitalEvent.create).not.toHaveBeenCalled();
    expect(h.events).toHaveLength(0);
    expect(d).toMatchObject({
      synthesisId: 's2',
      templateVersion: 4,
      estado: 'hospitalizado',
      novedadTexto: 'Mejora',
      fechaEvento: '2026-10-03T10:00:00.000Z',
      yaRegistrado: null,
    });
    expect(d.columnas[0]).toEqual({
      nombre: 'Paciente',
      instruccion: expect.any(String),
    });
  });

  it('borrador: con evento previo se lo pasa a la IA; si ya está registrado no llama al LLM', async () => {
    const h = setup();
    await h.svc.create('t1', body());
    await h.svc.draft('t1');
    expect(h.generator.extract).not.toHaveBeenCalled(); // misma síntesis: ya registrado
    // nueva versión: simulamos otro evento previo de síntesis anterior
    h.events[0].synthesisId = 's1';
    const d = await h.svc.draft('t1');
    expect(d.yaRegistrado).toBeNull();
    expect(h.prompts[0]).toContain('"Paciente":"Maria"'); // evento previo en el prompt
  });

  it('borrador: 404, 409 (no listo/ocupado/revisión/sin síntesis) y 503 si falla la IA', async () => {
    const h = setup();
    await expect(h.svc.draft('nope')).rejects.toMatchObject({ status: 404 });
    for (const st of [
      'sin_analizar',
      'pendiente',
      'procesando',
      'necesita_revision',
      'error',
    ]) {
      h.thread.status = st;
      await expect(h.svc.draft('t1')).rejects.toMatchObject({ status: 409 });
    }
    h.thread.status = 'listo';
    h.prisma.synthesis.findMany = () => Promise.resolve([]);
    await expect(h.svc.draft('t1')).rejects.toMatchObject({ status: 409 });
    const f = setup({ llm: () => new Error('boom ' + SECRET) });
    await expect(f.svc.draft('t1')).rejects.toMatchObject({
      status: 503,
      message: expect.not.stringContaining(SECRET),
    });
    expect(f.events).toHaveLength(0);
  });

  it('alta: guarda con fecha local de la zona del reporte y completa columnas faltantes', async () => {
    const h = setup();
    const ev = await h.svc.create(
      't1',
      body({
        datos: { Paciente: ' Maria ' },
        fechaEvento: '2026-10-04T03:00:00.000Z',
      }),
    );
    expect(ev).toMatchObject({
      threadId: 't1',
      synthesisId: 's2',
      fecha: '2026-10-03', // 03:00Z = 21:00 del día anterior en CDMX
      estado: 'hospitalizado',
      templateVersion: 4,
      novedadTexto: 'Mejora',
    });
    expect(ev.datos.Paciente).toBe('Maria');
    expect(ev.datos.Hospital).toBe('');
    expect(ev.columnas).toContain('Diagnóstico');
  });

  it('alta: unicidad por (hilo, síntesis) -> 409, también ante carrera P2002', async () => {
    const h = setup();
    await h.svc.create('t1', body());
    await expect(h.svc.create('t1', body())).rejects.toMatchObject({
      status: 409,
    });
    h.prisma.hospitalEvent.findFirst = () => Promise.resolve(null); // carrera
    await expect(h.svc.create('t1', body())).rejects.toMatchObject({
      status: 409,
    });
    expect(h.events).toHaveLength(1);
  });

  it('alta: validaciones 400/409/404', async () => {
    const h = setup();
    const bad = async (o: any, status: number) =>
      expect(h.svc.create('t1', body(o))).rejects.toMatchObject({ status });
    await bad({ synthesisId: undefined }, 400);
    await bad({ synthesisId: 's1' }, 409); // no es la vigente
    await bad({ estado: 'muerto' }, 400);
    await bad({ fechaEvento: 'ayer' }, 400);
    await bad({ fechaEvento: '1990-01-01T00:00:00Z' }, 400);
    await bad({ fechaEvento: '2999-01-01T00:00:00Z' }, 400);
    await bad({ fechaEvento: 5 }, 400);
    await bad({ datos: [] }, 400);
    await bad({ datos: null }, 400);
    await bad({ datos: { Inventada: 'x' } }, 400);
    await bad({ datos: { Paciente: 5 } }, 400);
    await bad({ datos: { Paciente: 'x'.repeat(2001) } }, 400);
    await bad({ novedadTexto: 'x'.repeat(1001) }, 400);
    await bad({ novedadTexto: 5 }, 400);
    await expect(h.svc.create('t1', undefined as any)).rejects.toMatchObject({
      status: 400,
    });
    await expect(h.svc.create('nope', body())).rejects.toMatchObject({
      status: 404,
    });
    h.thread.status = 'necesita_revision';
    await expect(h.svc.create('t1', body())).rejects.toMatchObject({
      status: 409,
    });
    expect(h.events).toHaveLength(0);
  });

  it('lista (más reciente primero) y baja; 404 al borrar inexistente', async () => {
    const h = setup();
    await h.svc.create('t1', body({ fechaEvento: '2026-10-02T10:00:00.000Z' }));
    h.events[0].synthesisId = 's1'; // primer evento de otra versión
    const e2 = await h.svc.create(
      't1',
      body({ fechaEvento: '2026-10-04T10:00:00.000Z' }),
    );
    const l = await h.svc.list('t1');
    expect(l.eventos.map((e) => e.id)).toEqual([e2.id, 'e1']);
    expect(l.synthesisId).toBe('s2');
    await expect(h.svc.list('nope')).rejects.toMatchObject({ status: 404 });
    await h.svc.remove(e2.id);
    expect((await h.svc.list('t1')).eventos).toHaveLength(1);
    await expect(h.svc.remove('zzz')).rejects.toMatchObject({ status: 404 });
  });

  it('no escribe contenido de pacientes ni del hilo en los logs', async () => {
    const spies = ['log', 'warn', 'error', 'debug', 'verbose'].map((m) =>
      jest.spyOn(Logger.prototype, m as 'log').mockImplementation(),
    );
    const f = setup({ llm: () => new Error('x') });
    await f.svc.draft('t1').catch(() => undefined);
    const h = setup();
    await h.svc.draft('t1');
    await h.svc.create('t1', body({ datos: { Paciente: SECRET } }));
    const all = spies.flatMap((s) => s.mock.calls).join(' ');
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('Maria');
    spies.forEach((s) => s.mockRestore());
  });
});
