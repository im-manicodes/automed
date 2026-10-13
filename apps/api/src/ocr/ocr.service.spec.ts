import { CancelledError } from '../jobs/cancelled.error';
import { OcrService } from './ocr.service';
import type { OcrEngine, OcrWord } from './ocr-engine.interface';

const word = (text: string, confidence: number): OcrWord => ({
  text,
  confidence,
  box: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
});

function setup(
  opts: {
    existingPages?: number;
    visionEnabled?: boolean;
    /** Lectura que devuelve la pasada única para cada zona (null = sin lectura). */
    visionReading?: { text: string; confidence: number } | null;
    /** Respuesta de pdf-extract por página; null = servicio caído/desactivado. */
    textPages?:
      | {
          pageNumber: number;
          kind: 'digital' | 'escaneada';
          markdown: string;
        }[]
      | null;
  } = {},
) {
  const created: any[] = [];
  const prisma: any = {
    attachment: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'att1',
        sha256: 'abc',
        storageKey: 'hilos/t1/pdf_2/original.pdf',
      }),
    },
    ocrPage: {
      count: jest.fn().mockResolvedValue(opts.existingPages ?? 0),
      create: jest.fn((a: any) => {
        created.push(a.data);
        return a;
      }),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
    message: {
      findUnique: jest.fn().mockResolvedValue({ threadId: 't1' }),
    },
    setting: { upsert: jest.fn().mockResolvedValue(undefined) },
  };
  const storage: any = {
    get: jest.fn().mockResolvedValue(new Uint8Array([1])),
    put: jest.fn().mockResolvedValue(undefined),
  };
  const rasterizer: any = {
    rasterize: jest.fn().mockResolvedValue([
      { pageNumber: 1, width: 100, height: 200, png: new Uint8Array([9]) },
      { pageNumber: 2, width: 100, height: 200, png: new Uint8Array([8]) },
    ]),
  };
  const engine: OcrEngine = {
    name: 'mock',
    recognize: jest.fn((_img, n: number) =>
      Promise.resolve({
        pageNumber: n,
        words: [],
        lines: [word('claro', 0.97), word('borroso', 0.4)],
      }),
    ),
  };
  const vision: any = {
    isEnabled: jest.fn().mockResolvedValue(opts.visionEnabled ?? false),
    acceptThreshold: 0.9,
    getMaxRegions: jest.fn().mockResolvedValue(10),
    modelFor: jest.fn().mockResolvedValue('modelo-lectura'),
    // Pasada única: por zona, `visionReading` y 2 alternativas.
    readZones: jest.fn((_png: unknown, items: any[]) =>
      Promise.resolve(
        items.map((it) => ({
          lectura: opts.visionReading ?? null,
          sugerencias: [`S1 ${it.ocrText}`, `S2 ${it.ocrText}`],
        })),
      ),
    ),
  };
  const pdfText: any = {
    extract: jest.fn().mockResolvedValue(opts.textPages ?? null),
  };
  const config: any = { get: () => undefined };
  const svc = new OcrService(
    config,
    prisma,
    storage,
    rasterizer,
    engine,
    vision,
    pdfText,
  );
  return { svc, prisma, storage, rasterizer, engine, vision, pdfText, created };
}

describe('OcrService (procesador de adjuntos)', () => {
  it('rasteriza, sube páginas, ejecuta el motor y guarda regiones con umbral 0.85', async () => {
    const { svc, storage, engine, created } = setup();
    await svc.process('att1');

    expect(storage.put).toHaveBeenCalledWith(
      'hilos/t1/pdf_2/pagina_1.png',
      expect.anything(),
      'image/png',
    );
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      attachmentId: 'att1',
      sha256: 'abc',
      pageNumber: 1,
      imageKey: 'hilos/t1/pdf_2/pagina_1.png',
      width: 100,
      height: 200,
      engine: 'mock',
    });
    const regions = created[0].regions.create;
    expect(regions.map((r: any) => r.status)).toEqual(['ok', 'dudoso']);
    expect(regions[0]).toMatchObject({ x: 0.1, w: 0.2, source: 'ocr' });
  });

  it('página pobre en conjunto (sin líneas bajo 0.85) marca las más débiles para revisión', async () => {
    const { svc, engine, created } = setup();
    (engine.recognize as jest.Mock).mockImplementation((_i, n: number) =>
      Promise.resolve({
        pageNumber: n,
        words: [],
        lines: [word('uno', 0.86), word('dos', 0.74), word('tres', 0.7)],
      }),
    );
    await svc.process('att1');
    const st = created[0].regions.create.map((r: any) => r.status);
    expect(st).toEqual(['ok', 'dudoso', 'dudoso']);
  });

  it('página buena en conjunto no se marca', async () => {
    const { svc, engine, created } = setup();
    (engine.recognize as jest.Mock).mockImplementation((_i, n: number) =>
      Promise.resolve({
        pageNumber: n,
        words: [],
        lines: [word('uno', 0.9), word('dos', 0.88)],
      }),
    );
    await svc.process('att1');
    expect(created[0].regions.create.map((r: any) => r.status)).toEqual([
      'ok',
      'ok',
    ]);
  });

  it('dedupe por sha256: si ya hay páginas no vuelve a procesar', async () => {
    const { svc, rasterizer, engine, prisma } = setup({ existingPages: 3 });
    await svc.process('att1');
    expect(prisma.ocrPage.count).toHaveBeenCalledWith({
      where: { sha256: 'abc' },
    });
    expect(rasterizer.rasterize).not.toHaveBeenCalled();
    expect(engine.recognize).not.toHaveBeenCalled();
  });

  it('con visión activa y relectura de alta confianza la región dudosa pasa a ok', async () => {
    const { svc, created, vision } = setup({
      visionEnabled: true,
      visionReading: { text: 'borrosa leída', confidence: 0.95 },
    });
    await svc.process('att1');
    expect(vision.readZones).toHaveBeenCalledTimes(2); // 1 por página, una sola pasada
    expect(vision.readZones.mock.calls[0][2]).toBe('t1');
    const r = created[0].regions.create[1];
    expect(r).toMatchObject({
      status: 'ok',
      text: 'borrosa leída',
      confidence: 0.95,
      source: 'vision',
    });
    expect(r).not.toHaveProperty('sugerencias');
  });

  it('relectura de baja confianza o sin respuesta deja la región dudosa con sus sugerencias', async () => {
    for (const reading of [{ text: 'x', confidence: 0.5 }, null]) {
      const { svc, created, vision } = setup({
        visionEnabled: true,
        visionReading: reading,
      });
      await svc.process('att1');
      expect(vision.readZones).toHaveBeenCalledTimes(2);
      expect(created[0].regions.create[1]).toMatchObject({
        status: 'dudoso',
        text: 'borroso',
        source: 'ocr',
        sugerencias: ['S1 borroso', 'S2 borroso'],
      });
      expect(created[0].regions.create[0]).not.toHaveProperty('sugerencias');
    }
  });

  it('sin visión no llama al LLM ni guarda sugerencias', async () => {
    const { svc, vision, created } = setup({ visionEnabled: false });
    await svc.process('att1');
    expect(vision.readZones).not.toHaveBeenCalled();
    expect(
      created[0].regions.create.every((r: any) => !('sugerencias' in r)),
    ).toBe(true);
  });

  it('ignora el error de unicidad (otro worker ya guardó ese sha256)', async () => {
    const { svc, prisma } = setup();
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    await expect(svc.process('att1')).resolves.toBeUndefined();
  });

  describe('flujo híbrido (pdf-extract)', () => {
    const digital = (n: number) => ({
      pageNumber: n,
      kind: 'digital' as const,
      markdown: `# Título ${n}\n\n- item`,
    });
    const scanned = (n: number) => ({
      pageNumber: n,
      kind: 'escaneada' as const,
      markdown: '',
    });

    it('páginas digitales: markdown, engine pdf-text, sin regiones y sin motor ni visión', async () => {
      const { svc, engine, vision, storage, created } = setup({
        visionEnabled: true,
        textPages: [digital(1), digital(2)],
      });
      await svc.process('att1');
      expect(engine.recognize).not.toHaveBeenCalled();
      expect(vision.readZones).not.toHaveBeenCalled();
      expect(storage.put).toHaveBeenCalledTimes(2); // sigue guardando pagina_<k>.png
      expect(created).toHaveLength(2);
      expect(created[0]).toMatchObject({
        engine: 'pdf-text',
        text: '# Título 1\n\n- item',
        pageNumber: 1,
      });
      expect(created[0].regions.create).toEqual([]);
    });

    it('páginas escaneadas siguen el flujo de OCR', async () => {
      const { svc, engine, created } = setup({
        textPages: [scanned(1), scanned(2)],
      });
      await svc.process('att1');
      expect(engine.recognize).toHaveBeenCalledTimes(2);
      expect(created[0].engine).toBe('mock');
      expect(created[0].regions.create).toHaveLength(2);
    });

    it('PDF mixto: solo la escaneada pasa por el motor', async () => {
      const { svc, engine, created } = setup({
        textPages: [digital(1), scanned(2)],
      });
      await svc.process('att1');
      expect(engine.recognize).toHaveBeenCalledTimes(1);
      expect((engine.recognize as jest.Mock).mock.calls[0][1]).toBe(2);
      expect(created.map((c) => c.engine)).toEqual(['pdf-text', 'mock']);
      expect(created[0].regions.create).toEqual([]);
      expect(created[1].regions.create).toHaveLength(2);
    });

    it('servicio caído o PDF_TEXT_MODE=off (extract -> null): todo por OCR', async () => {
      const { svc, engine, created, pdfText } = setup({ textPages: null });
      await svc.process('att1');
      expect(pdfText.extract).toHaveBeenCalledTimes(1);
      expect(engine.recognize).toHaveBeenCalledTimes(2);
      expect(created.map((c) => c.engine)).toEqual(['mock', 'mock']);
    });

    it('dedupe por sha256: sin cambios no llama ni a pdf-extract', async () => {
      const { svc, pdfText, engine } = setup({
        existingPages: 2,
        textPages: [digital(1), digital(2)],
      });
      await svc.process('att1');
      expect(pdfText.extract).not.toHaveBeenCalled();
      expect(engine.recognize).not.toHaveBeenCalled();
    });
  });

  describe('cancelación cooperativa', () => {
    it('se detiene entre páginas con CancelledError y no guarda OcrPage parciales', async () => {
      const { svc, engine, prisma, created } = setup();
      let calls = 0;
      const shouldContinue = jest.fn(() => Promise.resolve(++calls < 2));
      await expect(
        svc.process('att1', { shouldContinue }),
      ).rejects.toBeInstanceOf(CancelledError);
      expect(engine.recognize).toHaveBeenCalledTimes(1); // solo la página 1
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
    });

    it('se detiene entre lotes de visión (sin más llamadas al LLM ni OcrPage)', async () => {
      const { svc, engine, vision, prisma, created } = setup({
        visionEnabled: true,
      });
      (engine.recognize as jest.Mock).mockImplementation((_i, n: number) =>
        Promise.resolve({
          pageNumber: n,
          words: [],
          lines: Array.from({ length: 8 }, (_, i) => word(`d${i}`, 0.4)),
        }),
      );
      // página 1: ok; 1er lote: ok; 2º lote: cancelado
      let calls = 0;
      const shouldContinue = jest.fn(() => Promise.resolve(++calls < 3));
      await expect(
        svc.process('att1', { shouldContinue }),
      ).rejects.toBeInstanceOf(CancelledError);
      expect(vision.readZones).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
    });

    it('sin cancelar procesa todo normalmente', async () => {
      const { svc, created } = setup();
      await svc.process('att1', {
        shouldContinue: () => Promise.resolve(true),
      });
      expect(created).toHaveLength(2);
    });
  });

  describe('pasada única en lote (readDoubtfulZones)', () => {
    const dudosas = (n: number, okCount = 0) => [
      ...Array.from({ length: okCount }, (_, i) => ({
        box: { x: 0, y: 0, w: 0.1, h: 0.1 },
        text: `ok${i}`,
        confidence: 0.99,
        status: 'ok' as const,
        source: 'ocr' as const,
      })),
      ...Array.from({ length: n }, (_, i) => ({
        box: { x: 0, y: i / 20, w: 0.1, h: 0.05 },
        text: `d${i}`,
        confidence: 0.4,
        status: 'dudoso' as const,
        source: 'ocr' as const,
      })),
    ];
    const values = (prisma: any) =>
      prisma.setting.upsert.mock.calls.map((c: any[]) => c[0].update.value);
    const zona = (
      text: string | null,
      confidence = 0.95,
      sug: string[] = [],
    ) => ({
      lectura: text === null ? null : { text, confidence },
      sugerencias: sug,
    });

    it('progreso con modelo y regiones, sin pasada; el modelo se lee una vez', async () => {
      const { svc, prisma, vision } = setup({ visionEnabled: true });
      await svc.readDoubtfulZones(new Uint8Array([1]), dudosas(8), 't1');
      expect(prisma.setting.upsert.mock.calls[0][0].where).toEqual({
        key: 'progress:t1',
      });
      expect(values(prisma)).toEqual([
        {
          etapa: 'vision_enviando',
          regiones: { total: 8, hechas: 0 },
          modelo: 'modelo-lectura',
        },
        {
          etapa: 'vision_procesando',
          regiones: { total: 8, hechas: 0 },
          modelo: 'modelo-lectura',
        },
        {
          etapa: 'vision_procesando',
          regiones: { total: 8, hechas: 6 },
          modelo: 'modelo-lectura',
        },
      ]);
      expect(vision.modelFor).toHaveBeenCalledTimes(1);
      expect(vision.modelFor).toHaveBeenCalledWith('vision');
    });

    it('si no se puede leer el modelo, el progreso sale sin él y el OCR sigue', async () => {
      const { svc, prisma, vision } = setup({ visionEnabled: true });
      vision.modelFor.mockRejectedValue(new Error('x'));
      await svc.readDoubtfulZones(new Uint8Array([1]), dudosas(1), 't1');
      expect(values(prisma)[0]).toEqual({
        etapa: 'vision_enviando',
        regiones: { total: 1, hechas: 0 },
      });
    });

    it('8 dudosas -> 2 lotes (6+2), una sola llamada por lote, con threadId', async () => {
      const { svc, vision } = setup({ visionEnabled: true });
      vision.readZones.mockImplementation((_p: unknown, items: any[]) =>
        Promise.resolve(items.map((it) => zona('L' + it.ocrText))),
      );
      const out = await svc.readDoubtfulZones(
        new Uint8Array([1]),
        dudosas(8, 2),
        't1',
      );
      expect(vision.readZones).toHaveBeenCalledTimes(2);
      expect(vision.readZones.mock.calls[0][1]).toHaveLength(6);
      expect(vision.readZones.mock.calls[1][1]).toHaveLength(2);
      expect(vision.readZones.mock.calls[0][2]).toBe('t1');
      expect(out.filter((r) => r.source === 'vision')).toHaveLength(8);
      expect(out.slice(0, 2).every((r) => r.source === 'ocr')).toBe(true);
    });

    it('aceptación por umbral; lo no resuelto queda dudoso con sugerencias y sin más pasadas', async () => {
      const { svc, vision } = setup({ visionEnabled: true });
      vision.readZones.mockResolvedValue([
        zona('a', 0.95, ['a', 'a2']),
        zona(null, 0, ['b1', 'b2']),
        zona('c', 0.3, ['c', 'c1']),
      ]);
      const out = await svc.readDoubtfulZones(new Uint8Array([1]), dudosas(3));
      expect(vision.readZones).toHaveBeenCalledTimes(1);
      expect(out[0]).toMatchObject({
        status: 'ok',
        text: 'a',
        source: 'vision',
      });
      expect(out[0]).not.toHaveProperty('sugerencias');
      expect(out[1]).toMatchObject({
        status: 'dudoso',
        text: 'd1',
        source: 'ocr',
        sugerencias: ['b1', 'b2'],
      });
      expect(out[2]).toMatchObject({
        status: 'dudoso',
        text: 'd2',
        confidence: 0.4,
        sugerencias: ['c', 'c1'],
      });
    });

    it('zona dudosa sin sugerencias válidas no lleva la propiedad', async () => {
      const { svc, vision } = setup({ visionEnabled: true });
      vision.readZones.mockResolvedValue([zona(null)]);
      const out = await svc.readDoubtfulZones(new Uint8Array([1]), dudosas(1));
      expect(out[0].status).toBe('dudoso');
      expect(out[0]).not.toHaveProperty('sugerencias');
    });

    it('un lote fallido deja esas zonas dudosas sin sugerencias y sigue con el resto', async () => {
      const { svc, vision } = setup({ visionEnabled: true });
      vision.readZones
        .mockRejectedValueOnce(new Error('boom'))
        .mockImplementationOnce((_p: unknown, items: any[]) =>
          Promise.resolve(items.map(() => zona(null, 0, ['x']))),
        );
      const out = await svc.readDoubtfulZones(new Uint8Array([1]), dudosas(8));
      expect(vision.readZones).toHaveBeenCalledTimes(2);
      expect(out.slice(0, 6).every((r) => !r.sugerencias)).toBe(true);
      expect(out.slice(6).every((r) => r.sugerencias?.[0] === 'x')).toBe(true);
      expect(out.every((r) => r.status === 'dudoso')).toBe(true);
    });

    it('un lote fallido no rompe el OCR: el adjunto se guarda', async () => {
      const { svc, vision, created } = setup({ visionEnabled: true });
      vision.readZones.mockRejectedValue(new Error('boom'));
      await svc.process('att1');
      expect(created).toHaveLength(2);
      expect(created[0].regions.create[1].status).toBe('dudoso');
      expect(created[0].regions.create[1]).not.toHaveProperty('sugerencias');
    });

    it('respeta getMaxRegions por página', async () => {
      const { svc, vision } = setup({ visionEnabled: true });
      vision.getMaxRegions.mockResolvedValue(4);
      vision.readZones.mockImplementation((_p: unknown, items: any[]) =>
        Promise.resolve(items.map(() => zona('x'))),
      );
      const out = await svc.readDoubtfulZones(new Uint8Array([1]), dudosas(8));
      expect(vision.readZones.mock.calls[0][1]).toHaveLength(4);
      expect(out.filter((r) => r.status === 'ok')).toHaveLength(4);
      expect(out.filter((r) => r.status === 'dudoso')).toHaveLength(4);
    });

    it('respeta la cancelación entre lotes', async () => {
      const { svc, vision } = setup({ visionEnabled: true });
      let calls = 0;
      const shouldContinue = jest.fn(() => Promise.resolve(++calls < 2));
      await expect(
        svc.readDoubtfulZones(
          new Uint8Array([1]),
          dudosas(8),
          't1',
          shouldContinue,
        ),
      ).rejects.toBeInstanceOf(CancelledError);
      expect(vision.readZones).toHaveBeenCalledTimes(1);
    });

    it('sin dudosas o con visión apagada no hay llamadas; las ok nunca se envían', async () => {
      const a = setup({ visionEnabled: true });
      await a.svc.readDoubtfulZones(new Uint8Array([1]), dudosas(0, 3));
      expect(a.vision.readZones).not.toHaveBeenCalled();
      const b = setup({ visionEnabled: false });
      await b.svc.readDoubtfulZones(new Uint8Array([1]), dudosas(3));
      expect(b.vision.readZones).not.toHaveBeenCalled();
      const c = setup({ visionEnabled: true });
      await c.svc.readDoubtfulZones(new Uint8Array([1]), dudosas(2, 3));
      const sent = c.vision.readZones.mock.calls[0][1].map(
        (i: any) => i.ocrText,
      );
      expect(sent).toEqual(['d0', 'd1']);
    });
  });
});
