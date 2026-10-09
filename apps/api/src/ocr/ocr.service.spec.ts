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
    reread: jest.fn().mockResolvedValue(opts.visionReading ?? null),
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
      expect(vision.reread).not.toHaveBeenCalled();
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
});
