import { OcrService, pageImageKey } from './ocr.service';
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
    visionReading?: { text: string; confidence: number } | null;
  } = {},
) {
  const created: any[] = [];
  const prisma: any = {
    attachment: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'att1',
        sha256: 'abc',
        storageKey: 'pdfs/abc.pdf',
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
    enabled: opts.visionEnabled ?? false,
    acceptThreshold: 0.9,
    maxRegions: 10,
    reread: jest.fn().mockResolvedValue(opts.visionReading ?? null),
  };
  const config: any = { get: () => undefined };
  const svc = new OcrService(
    config,
    prisma,
    storage,
    rasterizer,
    engine,
    vision,
  );
  return { svc, prisma, storage, rasterizer, engine, vision, created };
}

describe('OcrService (procesador de adjuntos)', () => {
  it('rasteriza, sube páginas, ejecuta el motor y guarda regiones con umbral 0.85', async () => {
    const { svc, storage, engine, created } = setup();
    await svc.process('att1');

    expect(storage.put).toHaveBeenCalledWith(
      pageImageKey('abc', 1),
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
      imageKey: 'pages/abc/1.png',
      width: 100,
      height: 200,
      engine: 'mock',
    });
    const regions = created[0].regions.create;
    expect(regions.map((r: any) => r.status)).toEqual(['ok', 'dudoso']);
    expect(regions[0]).toMatchObject({ x: 0.1, w: 0.2, source: 'ocr' });
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
    expect(vision.reread).toHaveBeenCalledTimes(2);
    const r = created[0].regions.create[1];
    expect(r).toMatchObject({
      status: 'ok',
      text: 'borrosa leída',
      confidence: 0.95,
      source: 'vision',
    });
  });

  it('relectura de baja confianza o sin respuesta deja la región dudosa', async () => {
    for (const reading of [{ text: 'x', confidence: 0.5 }, null]) {
      const { svc, created } = setup({
        visionEnabled: true,
        visionReading: reading,
      });
      await svc.process('att1');
      expect(created[0].regions.create[1].status).toBe('dudoso');
      expect(created[0].regions.create[1].text).toBe('borroso');
    }
  });

  it('sin visión no llama al LLM', async () => {
    const { svc, vision } = setup({ visionEnabled: false });
    await svc.process('att1');
    expect(vision.reread).not.toHaveBeenCalled();
  });

  it('ignora el error de unicidad (otro worker ya guardó ese sha256)', async () => {
    const { svc, prisma } = setup();
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    await expect(svc.process('att1')).resolves.toBeUndefined();
  });
});
