import { createCanvas } from '@napi-rs/canvas';
import {
  parseVisionBatch,
  VisionRetryService,
  VISION_BATCH_SYSTEM,
} from './vision-retry.service';

describe('parseVisionBatch', () => {
  it('lee un arreglo válido, aun con texto/markdown alrededor', () => {
    const raw =
      'Aquí:\n```json\n[{"n":1,"text":" A ","confidence":0.9},{"n":2,"text":"B","confidence":2}]\n```';
    expect(parseVisionBatch(raw, 2)).toEqual([
      { text: 'A', confidence: 0.9 },
      { text: 'B', confidence: 1 },
    ]);
  });

  it('elementos faltantes, [ilegible] o n fuera de rango -> null', () => {
    const raw =
      '[{"n":1,"text":"ok","confidence":0.9},{"n":2,"text":"x [ilegible]","confidence":0.9},{"n":9,"text":"z","confidence":0.9},{"n":0,"text":"z","confidence":0.9}]';
    expect(parseVisionBatch(raw, 3)).toEqual([
      { text: 'ok', confidence: 0.9 },
      null,
      null,
    ]);
  });

  it('JSON roto o sin arreglo -> todo null', () => {
    expect(parseVisionBatch('[{"n":1,', 2)).toEqual([null, null]);
    expect(parseVisionBatch('nada', 2)).toEqual([null, null]);
    expect(parseVisionBatch('{"text":"a"}', 1)).toEqual([null]);
  });
});

describe('VisionRetryService.rereadBatch', () => {
  it('hace una sola llamada con N imágenes y el system de lote (+ámbito)', async () => {
    const llm: any = {
      complete: jest
        .fn()
        .mockResolvedValue(
          '[{"n":1,"text":"A","confidence":0.9},{"n":2,"text":"B","confidence":0.8}]',
        ),
      vision: jest.fn(),
    };
    const ocrSettings: any = {
      getEffective: jest
        .fn()
        .mockResolvedValue({ visionAmbito: 'Notas médicas' }),
    };
    const svc = new VisionRetryService(
      { get: () => undefined } as any,
      ocrSettings,
      llm,
    );
    const png = new Uint8Array(createCanvas(100, 100).toBuffer('image/png'));
    const out = await svc.rereadBatch(png, [
      { box: { x: 0, y: 0, w: 0.5, h: 0.5 }, ocrText: 'a' },
      { box: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, ocrText: 'b' },
    ]);
    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(llm.vision).not.toHaveBeenCalled();
    const req = llm.complete.mock.calls[0][0];
    expect(req.images).toHaveLength(2);
    expect(req.task).toBe('vision');
    expect(req.system.startsWith(VISION_BATCH_SYSTEM)).toBe(true);
    expect(req.system).toContain('Notas médicas');
    expect(out).toEqual([
      { text: 'A', confidence: 0.9 },
      { text: 'B', confidence: 0.8 },
    ]);
  });

  it('con task vision_respaldo hace una sola llamada con N imágenes y ese task', async () => {
    const llm: any = {
      complete: jest
        .fn()
        .mockResolvedValue(
          '[{"n":1,"text":"A","confidence":0.9},{"n":2,"text":"B","confidence":0.8},{"n":3,"text":"C","confidence":0.7}]',
        ),
    };
    const svc = new VisionRetryService(
      { get: () => undefined } as any,
      {
        getEffective: jest.fn().mockResolvedValue({ visionAmbito: '' }),
      } as any,
      llm,
    );
    const png = new Uint8Array(createCanvas(100, 100).toBuffer('image/png'));
    const box = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const out = await svc.rereadBatch(
      png,
      [1, 2, 3].map(() => ({ box, ocrText: 'x' })),
      'vision_respaldo',
    );
    expect(llm.complete).toHaveBeenCalledTimes(1);
    const req = llm.complete.mock.calls[0][0];
    expect(req.images).toHaveLength(3);
    expect(req.task).toBe('vision_respaldo');
    expect(out).toHaveLength(3);
  });
});
