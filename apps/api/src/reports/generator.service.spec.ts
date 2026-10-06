import { Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { GeneratorService } from './generator.service';
import { DEFAULT_REPORT_TEMPLATE_MARKDOWN } from '../templates/report-columns';

const SECRET = 'JUAN-PEREZ-DIAGNOSTICO-SECRETO';

interface T {
  id: string;
  subject: string;
  status: string;
  tieneMensajesNuevos: boolean;
  lastMessageAt: Date | null;
  syntheses: { id: string; markdown: string; createdAt: Date }[];
}

function setup(threads: T[], llmReplies: (prompt: string) => string | Error) {
  const reports: any[] = [];
  const rows: any[] = [];
  const cache: any[] = [];
  const events: any[] = [];
  const files = new Map<string, Uint8Array>();
  const matchesBase = (r: any, w: any) =>
    w.threadId.in.includes(r.threadId) &&
    r.extraccionOk === w.extraccionOk &&
    reports.some(
      (rep) =>
        rep.id === r.reportId &&
        rep.status === w.report.status &&
        rep.fecha < w.report.fecha.lt,
    );
  const prisma: any = {
    report: {
      findUnique: ({ where }: any) =>
        Promise.resolve(reports.find((r) => r.id === where.id) ?? null),
      update: ({ where, data }: any) => {
        const r = reports.find((x) => x.id === where.id);
        Object.assign(r, data);
        return Promise.resolve(r);
      },
    },
    setting: {
      findUnique: () => Promise.resolve({ value: 'America/Mexico_City' }),
    },
    thread: {
      findMany: ({ where }: any) =>
        Promise.resolve(
          where.syntheses
            ? threads.filter((t) => t.syntheses.length)
            : threads.filter(
                (t) =>
                  t.status === 'sin_analizar' ||
                  t.status === 'error' ||
                  t.tieneMensajesNuevos,
              ),
        ),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    reportRow: {
      deleteMany: ({ where }: any) => {
        for (let i = rows.length - 1; i >= 0; i--)
          if (rows[i].reportId === where.reportId) rows.splice(i, 1);
        return Promise.resolve({});
      },
      create: ({ data }: any) => {
        const r = {
          id: `r${rows.length}`,
          createdAt: new Date(rows.length),
          ...data,
        };
        rows.push(r);
        return Promise.resolve(r);
      },
      findMany: ({ where }: any) =>
        Promise.resolve(
          rows
            .filter((r) => matchesBase(r, where))
            .sort((a, b) => b.createdAt - a.createdAt),
        ),
    },
    hospitalEvent: {
      findMany: () =>
        Promise.resolve(
          [...events].sort((a, b) => b.fechaEvento - a.fechaEvento),
        ),
    },
    threadReportData: {
      findFirst: ({ where }: any) =>
        Promise.resolve(
          cache.find(
            (c) =>
              c.threadId === where.threadId &&
              c.synthesisId === where.synthesisId &&
              c.templateVersion === where.templateVersion,
          ) ?? null,
        ),
      create: ({ data }: any) => {
        cache.push(data);
        return Promise.resolve(data);
      },
    },
  };
  const prompts: string[] = [];
  const llm: any = {
    text: jest.fn((_s: string, p: string) => {
      prompts.push(p);
      const r = llmReplies(p);
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    }),
  };
  const storage: any = {
    exists: (k: string) => Promise.resolve(files.has(k)),
    put: (k: string, b: Uint8Array) => {
      files.set(k, b);
      return Promise.resolve();
    },
  };
  const templates: any = {
    getActive: () =>
      Promise.resolve({
        version: 3,
        markdown: DEFAULT_REPORT_TEMPLATE_MARKDOWN,
      }),
  };
  const config: any = {
    get: (k: string) => (k === 'WEB_ORIGIN' ? 'http://web' : undefined),
  };
  const svc = new GeneratorService(prisma, storage, templates, config, llm);
  const newReport = (fecha: string): any => {
    const r = {
      id: `rep${reports.length}`,
      fecha,
      trigger: 'manual',
      status: 'generando',
    };
    reports.push(r);
    return r;
  };
  return {
    svc,
    prisma,
    llm,
    prompts,
    files,
    reports,
    rows,
    cache,
    events,
    newReport,
  };
}

const thread = (id: string, synId: string, extra: Partial<T> = {}): T => ({
  id,
  subject: `Asunto ${id}`,
  status: 'listo',
  tieneMensajesNuevos: false,
  lastMessageAt: new Date('2026-10-05T00:00:00Z'),
  syntheses: [
    {
      id: synId,
      markdown: `Resumen ${SECRET} ${id}`,
      createdAt: new Date('2026-10-05T10:00:00Z'),
    },
  ],
  ...extra,
});

const reply = (estado: string, paciente = 'Ana') =>
  JSON.stringify({
    estado,
    novedad_texto: 'Algo pasó',
    columnas: { Paciente: paciente, Hospital: 'H1' },
  });

async function readXlsx(buf: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe('GeneratorService', () => {
  const NOW = new Date('2026-10-06T13:00:00Z'); // 07:00 CDMX

  it('genera el Excel con hospitalizados, guarda en RustFS y registra totales', async () => {
    const h = setup(
      [
        thread('t1', 's1'),
        thread('t2', 's2'),
        thread('t3', 's3'),
        thread('t4', 's4', { status: 'sin_analizar', syntheses: [] }),
        thread('t5', 's5', { tieneMensajesNuevos: true }),
      ],
      (p) =>
        p.includes('Resumen ' + SECRET + ' t2')
          ? reply('alta', 'Luis')
          : p.includes(' t3')
            ? reply('otro')
            : reply('hospitalizado'),
    );
    const rep = h.newReport('2026-10-06');
    await h.svc.generate(rep.id, NOW);
    expect(rep).toMatchObject({
      status: 'listo',
      totalHospitalizados: 2, // t1 y t5
      totalAltas: 1,
      totalConNovedad: 3,
      total: 4,
      procesados: 4,
      templateVersion: 3,
      storageKey: 'reportes/2026-10-06/reporte_0700.xlsx',
    });
    expect(h.files.has('reportes/2026-10-06/reporte_0700.xlsx')).toBe(true);
    const wb = await readXlsx(h.files.get(rep.storageKey)!);
    const pac = wb.getWorksheet('Pacientes')!;
    expect(pac.rowCount).toBe(4); // encabezado + t1 + t2 + t5
    // sin hoja de pendientes: t4 (sin síntesis) no entra ni se lista
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Resumen del día',
      'Pacientes',
      'Eventos',
    ]);
    expect(
      JSON.stringify(wb.getWorksheet('Pacientes')!.getSheetValues()),
    ).not.toContain('t4');
    const t5 = [2, 3, 4]
      .map((i) => JSON.stringify(pac.getRow(i).getCell(3).value))
      .find((v) => v.includes('desactualizado'));
    expect(t5).toContain('Resumen desactualizado: hay mensajes sin analizar');
  });

  it('no dispara análisis ni reenvía hilos: solo la síntesis vigente al LLM, sin tocar hilos', async () => {
    const h = setup(
      [
        thread('t1', 's1', {
          status: 'sin_analizar',
          tieneMensajesNuevos: true,
        }),
      ],
      () => reply('hospitalizado'),
    );
    const rep = h.newReport('2026-10-06');
    await h.svc.generate(rep.id, NOW);
    expect(h.llm.text).toHaveBeenCalledTimes(1);
    expect(h.prompts[0]).toContain(`Resumen ${SECRET} t1`);
    expect(h.prisma.thread.update).not.toHaveBeenCalled();
    expect(h.prisma.thread.updateMany).not.toHaveBeenCalled();
  });

  it('caché: misma síntesis y versión de columnas no repite la llamada al LLM; síntesis nueva sí', async () => {
    const t = thread('t1', 's1');
    const h = setup([t], () => reply('hospitalizado'));
    await h.svc.generate(h.newReport('2026-10-06').id, NOW);
    await h.svc.generate(h.newReport('2026-10-07').id, NOW);
    expect(h.llm.text).toHaveBeenCalledTimes(1);
    expect(h.cache).toHaveLength(1);
    t.syntheses = [{ id: 's2', markdown: 'nuevo', createdAt: new Date() }];
    await h.svc.generate(h.newReport('2026-10-08').id, NOW);
    expect(h.llm.text).toHaveBeenCalledTimes(2);
  });

  it('JSON inválido: reintenta una vez; si sigue mal la fila sale incompleta y el reporte no aborta', async () => {
    const h = setup([thread('t1', 's1'), thread('t2', 's2')], (p) =>
      p.includes(' t1') ? 'esto no es json' : reply('hospitalizado'),
    );
    const rep = h.newReport('2026-10-06');
    await h.svc.generate(rep.id, NOW);
    expect(rep.status).toBe('listo');
    expect(h.llm.text).toHaveBeenCalledTimes(3); // t1 x2 + t2 x1
    const bad = h.rows.find((r) => r.threadId === 't1');
    expect(bad).toMatchObject({
      extraccionOk: false,
      novedad: true,
      estado: 'otro',
    });
    expect(h.cache.find((c) => c.threadId === 't1')).toBeUndefined(); // lo fallido no se cachea
    expect(h.rows.find((r) => r.threadId === 't2').extraccionOk).toBe(true);
  });

  it('una excepción del LLM en el primer intento se recupera en el reintento', async () => {
    let n = 0;
    const h = setup([thread('t1', 's1')], () =>
      n++ === 0 ? new Error('timeout') : reply('hospitalizado'),
    );
    const rep = h.newReport('2026-10-06');
    await h.svc.generate(rep.id, NOW);
    expect(h.rows[0].extraccionOk).toBe(true);
  });

  it('novedad respecto al reporte de un día anterior; el alta sale una sola vez', async () => {
    const t1 = thread('t1', 's1');
    const t2 = thread('t2', 's2');
    let estado2 = 'hospitalizado';
    const h = setup([t1, t2], (p) =>
      p.includes(' t2') ? reply(estado2, 'Luis') : reply('hospitalizado'),
    );
    // día 1: ambos entran como nuevos
    const r1 = h.newReport('2026-10-06');
    await h.svc.generate(r1.id, NOW);
    expect(r1.totalConNovedad).toBe(2);
    // día 2: sin cambios => censo sin novedad
    const r2 = h.newReport('2026-10-07');
    await h.svc.generate(r2.id, NOW);
    expect(r2).toMatchObject({ totalHospitalizados: 2, totalConNovedad: 0 });
    // día 3: t1 con síntesis nueva, t2 de alta
    t1.syntheses = [
      {
        id: 's1b',
        markdown: 'Resumen ' + SECRET + ' t1 v2',
        createdAt: new Date(),
      },
    ];
    t2.syntheses = [
      {
        id: 's2b',
        markdown: 'Resumen ' + SECRET + ' t2 v2',
        createdAt: new Date(),
      },
    ];
    estado2 = 'alta';
    const r3 = h.newReport('2026-10-08');
    await h.svc.generate(r3.id, NOW);
    expect(r3).toMatchObject({
      totalHospitalizados: 1,
      totalAltas: 1,
      totalConNovedad: 2,
    });
    // día 4: t2 sigue de alta (nueva síntesis) => ya no aparece
    t2.syntheses = [
      {
        id: 's2c',
        markdown: 'Resumen ' + SECRET + ' t2 v3',
        createdAt: new Date(),
      },
    ];
    const r4 = h.newReport('2026-10-09');
    await h.svc.generate(r4.id, NOW);
    expect(r4).toMatchObject({
      totalHospitalizados: 1,
      totalAltas: 0,
      totalConNovedad: 0,
    });
    expect(
      h.rows.filter((r) => r.reportId === r4.id).map((r) => r.threadId),
    ).toEqual(['t1']);
  });

  it('regenerar el mismo día compara contra el día anterior (el alta no desaparece)', async () => {
    const t2 = thread('t2', 's2');
    const h = setup([t2], () => reply('alta'));
    const a = h.newReport('2026-10-06');
    await h.svc.generate(a.id, NOW);
    const b = h.newReport('2026-10-06');
    await h.svc.generate(b.id, NOW);
    expect(b).toMatchObject({ totalAltas: 1, totalConNovedad: 1 });
    expect(b.storageKey).toContain('reporte_0700_'); // misma hora: no pisa el archivo anterior
  });

  it('un reintento sobre un reporte ya listo no repite trabajo', async () => {
    const h = setup([thread('t1', 's1')], () => reply('hospitalizado'));
    const rep = h.newReport('2026-10-06');
    await h.svc.generate(rep.id, NOW);
    await h.svc.generate(rep.id, NOW);
    expect(h.llm.text).toHaveBeenCalledTimes(1);
  });

  it('sin contenido de pacientes/correos en los logs', async () => {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
      (m) => jest.spyOn(Logger.prototype, m).mockImplementation(),
    );
    const h = setup([thread('t1', 's1'), thread('t2', 's2')], (p) =>
      p.includes(' t1')
        ? new Error('falló ' + 'x')
        : reply('hospitalizado', 'PACIENTE-X'),
    );
    await h.svc.generate(h.newReport('2026-10-06').id, NOW);
    const logged = spies.flatMap((s) => s.mock.calls.flat()).join('\n');
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain('PACIENTE-X');
    expect(logged).not.toContain('Asunto t');
    spies.forEach((s) => s.mockRestore());
  });

  it('carga los eventos de TODOS los hilos (sin LLM) y los pasa a la hoja Eventos', async () => {
    const h = setup([thread('t1', 's1')], () => reply('hospitalizado'));
    h.events.push(
      {
        threadId: 'otro-hilo',
        fechaEvento: new Date('2026-10-06T15:00:00Z'),
        fecha: '2026-10-06',
        estado: 'alta',
        novedadTexto: 'Egreso',
        data: { Paciente: 'Zoe' },
        createdAt: new Date('2026-10-06T16:00:00Z'),
      },
      {
        threadId: 't1',
        fechaEvento: new Date('2026-10-04T15:00:00Z'),
        fecha: '2026-10-04',
        estado: 'hospitalizado',
        novedadTexto: null,
        data: { Paciente: 'Ana' },
        createdAt: new Date('2026-10-04T16:00:00Z'),
      },
    );
    const rep = h.newReport('2026-10-06');
    await h.svc.generate(rep.id, NOW);
    expect(h.llm.text).toHaveBeenCalledTimes(1); // solo la extracción del censo
    const wb = await readXlsx(h.files.get(rep.storageKey)!);
    const ev = wb.getWorksheet('Eventos')!;
    expect(ev.rowCount).toBe(3);
    expect(ev.getRow(2).getCell(3).value).toBe('Egreso');
    const sum: string[] = [];
    wb.getWorksheet('Resumen del día')!.eachRow((r) =>
      sum.push(JSON.stringify(r.values)),
    );
    expect(sum.join('\n')).toContain('Eventos registrados","2 (hoy: 1)"');
  });
});
