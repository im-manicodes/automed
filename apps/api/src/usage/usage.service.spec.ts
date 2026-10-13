import { BadRequestException } from '@nestjs/common';
import { UsageService } from './usage.service';
import {
  costOf,
  normalizePrices,
  validatePrices,
  zonedStartOfDay,
} from './usage-pure';

const NOW = new Date('2026-10-12T18:00:00Z');

const row = (o: Record<string, unknown>) => ({
  createdAt: NOW,
  kind: 'llm',
  provider: 'openai',
  model: 'gpt-4.1',
  task: 'resumen',
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  pages: 0,
  estimated: false,
  ...o,
});

const PRICES = {
  moneda: 'USD',
  modelos: { 'gpt-4.1': { entrada: 2, salida: 8, cacheada: 0.5 } },
  ocr: { 'textract-detect': 0.0015 },
};

function make(rows: unknown[] = [], prices: unknown = PRICES, zona = 'UTC') {
  const settings: Record<string, unknown> = {
    'ia.precios': prices,
    'reporte.zona': zona,
  };
  const prisma = {
    llmUsage: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue(rows),
    },
    setting: {
      findUnique: jest.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(
          settings[where.key] == null ? null : { value: settings[where.key] },
        ),
      ),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  return { svc: new UsageService(prisma as never), prisma };
}

const yesterday = new Date('2026-10-11T12:00:00Z');
const sample = () => [
  row({ inputTokens: 1_000_000, cachedTokens: 500_000, outputTokens: 100_000 }),
  row({
    provider: 'ollama',
    model: 'qwen3-vl:4b-instruct',
    inputTokens: 1000,
    outputTokens: 100,
    estimated: true,
    createdAt: yesterday,
  }),
  row({
    kind: 'ocr',
    provider: 'textract',
    model: 'textract-detect',
    task: 'ocr',
    pages: 1,
  }),
  row({
    kind: 'ocr',
    provider: 'textract',
    model: 'textract-detect',
    task: 'ocr',
    pages: 1,
  }),
];

describe('UsageService.record', () => {
  it('guarda solo cifras y nunca lanza', async () => {
    const { svc, prisma } = make();
    await svc.record({
      kind: 'llm',
      provider: 'openai',
      model: 'gpt-4.1',
      task: 'resumen',
      inputTokens: 10.4,
      outputTokens: -3,
      threadId: 't1',
    });
    expect(prisma.llmUsage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputTokens: 10,
        outputTokens: 0,
        pages: 0,
        estimated: false,
        threadId: 't1',
      }),
    });
    prisma.llmUsage.create.mockRejectedValueOnce(new Error('sin tabla'));
    await expect(
      svc.record({
        kind: 'ocr',
        provider: 'azure',
        model: 'azure-read',
        task: 'ocr',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('UsageService.summary', () => {
  it('agrega por modelo/actividad y por día; costo con precio y «sin precio»', async () => {
    const { svc, prisma } = make(sample());
    const r = await svc.summary('7d', NOW);
    expect(r.desde).toBe('2026-10-06T00:00:00.000Z');
    expect(r.hasta).toBe(NOW.toISOString());
    expect(r.moneda).toBe('USD');
    expect(prisma.llmUsage.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date('2026-10-06T00:00:00.000Z'),
      lte: NOW,
    });
    expect(r.totales).toEqual({
      inputTokens: 1_001_000,
      outputTokens: 100_100,
      cachedTokens: 500_000,
      cacheWriteTokens: 0,
      paginasOcr: 2,
      costo: 2.053,
    });
    expect(r.modelosSinPrecio).toEqual(['qwen3-vl:4b-instruct']);
    const gpt = r.porModelo.find((g) => g.model === 'gpt-4.1')!;
    expect(gpt).toMatchObject({ llamadas: 1, costo: 2.05, estimado: false });
    const ocr = r.porModelo.find((g) => g.kind === 'ocr')!;
    expect(ocr).toMatchObject({ llamadas: 2, paginas: 2, costo: 0.003 });
    const qwen = r.porModelo.find((g) => g.provider === 'ollama')!;
    expect(qwen).toMatchObject({ costo: null, estimado: true });
    expect(r.porDia).toHaveLength(7);
    expect(r.porDia[6]).toEqual({
      fecha: '2026-10-12',
      costo: 2.053,
      tokens: 1_100_000,
    });
    expect(r.porDia[5]).toEqual({
      fecha: '2026-10-11',
      costo: 0,
      tokens: 1100,
    });
  });

  it('registros históricos con tareas retiradas (vision_respaldo/vision_sugerencias) se siguen agregando y valorando', async () => {
    const { svc } = make([
      row({ task: 'vision', inputTokens: 1_000_000 }),
      row({ task: 'vision_respaldo', inputTokens: 1_000_000 }),
      row({ task: 'vision_sugerencias', outputTokens: 1_000_000 }),
    ]);
    const r = await svc.summary('7d', NOW);
    expect(r.totales.costo).toBe(12);
    const tasks = r.porModelo.map((g) => g.task).sort();
    expect(tasks).toEqual(['vision', 'vision_respaldo', 'vision_sugerencias']);
    expect(r.porModelo.find((g) => g.task === 'vision_respaldo')).toMatchObject(
      { llamadas: 1, costo: 2 },
    );
    expect(
      r.porModelo.find((g) => g.task === 'vision_sugerencias'),
    ).toMatchObject({ llamadas: 1, costo: 8 });
  });

  it('periodos hoy y mes en la zona del reporte; periodo inválido -> 400', async () => {
    const { svc } = make([], PRICES, 'America/Mexico_City');
    expect((await svc.summary('hoy', NOW)).desde).toBe(
      '2026-10-12T06:00:00.000Z',
    );
    const mes = await svc.summary('mes', NOW);
    expect(mes.desde).toBe('2026-10-01T06:00:00.000Z');
    expect(mes.porDia).toHaveLength(12);
    await expect(svc.summary('año', NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('sin precios configurados todo queda «sin precio» y el costo total es 0', async () => {
    const { svc } = make(sample(), null);
    const r = await svc.summary('30d', NOW);
    expect(r.totales.costo).toBe(0);
    expect(r.modelosSinPrecio).toEqual(['gpt-4.1', 'qwen3-vl:4b-instruct']);
    expect(r.ocrSinPrecio).toEqual(['textract-detect']);
    expect(r.porModelo.every((g) => g.costo === null)).toBe(true);
  });
});

describe('UsageService.forecast', () => {
  it('promedio diario desde el primer día con datos, fin de mes y 30 días', async () => {
    const { svc } = make(sample());
    const f = await svc.forecast(undefined, NOW);
    expect(f.ventanaDias).toBe(7);
    expect(f.diasConDatos).toBe(2);
    expect(f.promedioDiario).toBe(1.0265);
    expect(f.proximos30Dias).toBe(30.795);
    // gasto real del mes (2.053) + promedio × 19 días que faltan de octubre
    expect(f.finDeMes).toBe(21.5565);
    expect(f.porModelo).toEqual([
      {
        model: 'gpt-4.1',
        task: 'resumen',
        promedioDiario: 1.025,
        proximos30Dias: 30.75,
      },
      {
        model: 'textract-detect',
        task: 'ocr',
        promedioDiario: 0.0015,
        proximos30Dias: 0.045,
      },
    ]);
  });

  it('con pocos datos (1 día) lo informa en diasConDatos; sin datos todo es 0', async () => {
    const { svc } = make([sample()[0]]);
    const f = await svc.forecast('14', NOW);
    expect(f).toMatchObject({
      ventanaDias: 14,
      diasConDatos: 1,
      promedioDiario: 2.05,
    });
    const { svc: vacio } = make([]);
    expect(await vacio.forecast('7', NOW)).toMatchObject({
      diasConDatos: 0,
      promedioDiario: 0,
      finDeMes: 0,
      proximos30Dias: 0,
      porModelo: [],
    });
  });

  it('días inválidos -> 400', async () => {
    const { svc } = make();
    for (const d of ['0', '91', 'x', '2.5']) {
      await expect(svc.forecast(d, NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });
});

describe('precios', () => {
  it('GET sin guardar devuelve la estructura vacía en USD', async () => {
    const { svc } = make([], null);
    expect(await svc.getPrices()).toEqual({
      moneda: 'USD',
      modelos: {},
      ocr: {},
    });
  });

  it('PUT válido se guarda en ia.precios', async () => {
    const { svc, prisma } = make();
    const body = {
      moneda: 'USD',
      modelos: {
        ' m1 ': { entrada: 1, salida: 2 },
        m2: { entrada: 0, salida: 0, cacheada: 0, escrituraCache: 2.5 },
      },
      ocr: { 'azure-read': 0.0015 },
    };
    const saved = await svc.savePrices(body);
    expect(saved).toEqual({
      moneda: 'USD',
      modelos: {
        m1: { entrada: 1, salida: 2 },
        m2: { entrada: 0, salida: 0, cacheada: 0, escrituraCache: 2.5 },
      },
      ocr: { 'azure-read': 0.0015 },
    });
    expect(prisma.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: 'ia.precios' } }),
    );
  });

  it.each([
    [null, 'objeto'],
    [{ moneda: 'EUR' }, 'USD'],
    [{ modelos: [] }, 'modelos'],
    [{ modelos: { m: { entrada: -1, salida: 1 } } }, 'mayor o igual a 0'],
    [{ modelos: { m: { entrada: '1', salida: 1 } } }, 'mayor o igual a 0'],
    [{ modelos: { m: { entrada: 1 } } }, 'salida'],
    [{ modelos: { m: { entrada: 1, salida: 1, cacheada: -2 } } }, 'cacheado'],
    [
      { modelos: { m: { entrada: 1, salida: 1, escrituraCache: -1 } } },
      'escritura en caché',
    ],
    [{ ocr: { 'otro-ocr': 1 } }, 'no es un servicio'],
    [{ ocr: { 'textract-detect': -0.1 } }, 'por página'],
  ])('PUT inválido %j -> 400 en español', async (body, msg) => {
    const { svc, prisma } = make();
    await expect(svc.savePrices(body)).rejects.toThrow(msg);
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });

  it('PUT descarta entradas de modelos que son motores OCR', async () => {
    const { svc, prisma } = make();
    const saved = await svc.savePrices({
      modelos: {
        'azure-read': { entrada: 0, salida: 0 },
        'textract-detect': { entrada: 1, salida: 1 },
        m1: { entrada: 1, salida: 2 },
      },
      ocr: { 'azure-read': 0.01 },
    });
    expect(saved.modelos).toEqual({ m1: { entrada: 1, salida: 2 } });
    expect(saved.ocr).toEqual({ 'azure-read': 0.01 });
    expect(JSON.stringify(prisma.setting.upsert.mock.calls[0])).not.toContain(
      '"azure-read":{"entrada"',
    );
  });

  it('GET no devuelve motores OCR guardados como modelos', async () => {
    const { svc } = make([], {
      modelos: {
        'azure-read': { entrada: 0, salida: 0 },
        ok: { entrada: 1, salida: 1 },
      },
      ocr: {},
    });
    expect((await svc.getPrices()).modelos).toEqual({
      ok: { entrada: 1, salida: 1 },
    });
  });

  it('lectura tolerante descarta precios rotos', () => {
    expect(
      normalizePrices({
        modelos: { ok: { entrada: 1, salida: 1 }, mal: { entrada: -1 } },
        ocr: { 'textract-analyze': 0.05, x: 1 },
      }),
    ).toEqual({
      moneda: 'USD',
      modelos: { ok: { entrada: 1, salida: 1 } },
      ocr: { 'textract-analyze': 0.05 },
    });
    expect(validatePrices({}).value).toEqual({
      moneda: 'USD',
      modelos: {},
      ocr: {},
    });
  });
});

describe('usage-pure', () => {
  it('costOf: sin precio de cacheados se cobran como entrada', () => {
    const prices = normalizePrices({
      modelos: { m: { entrada: 3, salida: 15 } },
    });
    expect(
      costOf(
        {
          kind: 'llm',
          model: 'm',
          inputTokens: 2_000_000,
          outputTokens: 1_000_000,
          cachedTokens: 1_000_000,
          pages: 0,
        },
        prices,
      ),
    ).toBe(21);
    expect(
      costOf(
        {
          kind: 'ocr',
          model: 'azure-read',
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          pages: 3,
        },
        prices,
      ),
    ).toBeNull();
  });

  it('costOf: escritura en caché con y sin precio propio', () => {
    const base = {
      kind: 'llm',
      model: 'sol',
      inputTokens: 3_000_000,
      outputTokens: 1_000_000,
      cachedTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      pages: 0,
    };
    const full = normalizePrices({
      modelos: {
        sol: { entrada: 2, salida: 10, cacheada: 0.2, escrituraCache: 2.5 },
      },
    });
    // 1M x 2 + 1M x 0.2 + 1M x 2.5 + 1M x 10
    expect(costOf(base, full)).toBeCloseTo(14.7);
    const sinEscritura = normalizePrices({
      modelos: { sol: { entrada: 2, salida: 10, cacheada: 0.2 } },
    });
    expect(costOf(base, sinEscritura)).toBeCloseTo(14.2);
    // compatibilidad: sin cacheWriteTokens el resultado es el de antes
    const viejo = { ...base, cacheWriteTokens: undefined };
    expect(costOf(viejo, full)).toBeCloseTo(2 * 2 + 0.2 + 10);
  });

  it('zonedStartOfDay respeta la zona', () => {
    expect(zonedStartOfDay('2026-10-12', 'UTC').toISOString()).toBe(
      '2026-10-12T00:00:00.000Z',
    );
    expect(zonedStartOfDay('2026-07-01', 'Europe/Madrid').toISOString()).toBe(
      '2026-06-30T22:00:00.000Z',
    );
  });
});
