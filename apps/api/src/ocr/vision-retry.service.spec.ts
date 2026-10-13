import { createCanvas } from '@napi-rs/canvas';
import {
  parseZonas,
  VisionRetryService,
  VISION_ZONAS_SYSTEM,
} from './vision-retry.service';

const items3 = [{ ocrText: 'Igual' }, { ocrText: 'q' }, { ocrText: 'z' }];

describe('parseZonas', () => {
  it('lee lectura, confianza y sugerencias aun con texto/markdown alrededor', () => {
    const raw =
      'Aquí:\n```json\n[{"n":1,"lectura":" A b ","confianza":0.9,"sugerencias":["Ab","C"]},' +
      '{"n":2,"lectura":"B","confianza":2,"sugerencias":[]}]\n```';
    expect(parseZonas(raw, items3)).toEqual([
      // "Ab" se descarta por igual a la lectura (sin espacios ni mayúsculas)
      { lectura: { text: 'A b', confidence: 0.9 }, sugerencias: ['A b', 'C'] },
      { lectura: { text: 'B', confidence: 1 }, sugerencias: ['B'] },
      { lectura: null, sugerencias: [] },
    ]);
  });

  it('sugerencias: sin vacías, [ilegible], duplicadas ni iguales al OCR previo; máx. 2', () => {
    const raw =
      '[{"n":1,"lectura":"x [ilegible]","confianza":0.9,"sugerencias":["", "igual", "[ilegible] y", "P", "p", "Q", "R"]},' +
      '{"n":2,"lectura":"Uno","confianza":0.3,"sugerencias":["Dos","Tres"]},' +
      '{"n":9,"lectura":"fuera","confianza":1},{"n":0,"lectura":"z","confianza":1}]';
    expect(parseZonas(raw, items3)).toEqual([
      { lectura: null, sugerencias: ['P', 'Q'] },
      {
        lectura: { text: 'Uno', confidence: 0.3 },
        sugerencias: ['Uno', 'Dos'],
      },
      { lectura: null, sugerencias: [] },
    ]);
  });

  it('tolera los nombres text/confidence', () => {
    expect(
      parseZonas('[{"n":1,"text":"ok","confidence":0.8}]', [{ ocrText: 'a' }]),
    ).toEqual([
      { lectura: { text: 'ok', confidence: 0.8 }, sugerencias: ['ok'] },
    ]);
  });

  it('confianza no numérica -> sin lectura, pero el texto sirve de sugerencia', () => {
    expect(
      parseZonas('[{"n":1,"lectura":"ok","confianza":"alta"}]', [
        { ocrText: 'a' },
      ]),
    ).toEqual([{ lectura: null, sugerencias: ['ok'] }]);
  });

  it('JSON roto o sin arreglo -> todo vacío', () => {
    const vacio = [
      { lectura: null, sugerencias: [] },
      { lectura: null, sugerencias: [] },
    ];
    const two = [{ ocrText: 'a' }, { ocrText: 'b' }];
    expect(parseZonas('[{"n":1,', two)).toEqual(vacio);
    expect(parseZonas('nada', two)).toEqual(vacio);
    expect(parseZonas('[{"n":1,"sugerencias":"x"},5,null]', two)).toEqual(
      vacio,
    );
  });
});

describe('VisionRetryService.modelFor', () => {
  it('devuelve solo el nombre del modelo de la tarea vision', async () => {
    const llm: any = { modelFor: jest.fn().mockResolvedValue('modelo-v') };
    const svc = new VisionRetryService(
      { get: () => undefined } as any,
      {} as any,
      llm,
    );
    await expect(svc.modelFor()).resolves.toBe('modelo-v');
    expect(llm.modelFor).toHaveBeenCalledWith('vision');
  });
});

describe('VisionRetryService.readZones', () => {
  it('una sola llamada con N imágenes, tarea vision, prompt de zonas (+ámbito) y threadId', async () => {
    const llm: any = {
      complete: jest
        .fn()
        .mockResolvedValue(
          '[{"n":1,"lectura":"A","confianza":0.9,"sugerencias":["A1"]},{"n":2,"lectura":"B","confianza":0.4,"sugerencias":["B1","B2"]}]',
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
    const out = await svc.readZones(
      png,
      [
        { box: { x: 0, y: 0, w: 0.5, h: 0.5 }, ocrText: 'x' },
        { box: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, ocrText: 'y' },
      ],
      'hilo-1',
    );
    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(llm.vision).not.toHaveBeenCalled();
    const req = llm.complete.mock.calls[0][0];
    expect(req.images).toHaveLength(2);
    expect(req.task).toBe('vision');
    expect(req.threadId).toBe('hilo-1'); // solo para el registro de uso
    expect(req.system.startsWith(VISION_ZONAS_SYSTEM)).toBe(true);
    expect(req.system).toContain('Notas médicas');
    expect(req.prompt).toContain('Recorte 2');
    expect(out).toEqual([
      { lectura: { text: 'A', confidence: 0.9 }, sugerencias: ['A', 'A1'] },
      { lectura: { text: 'B', confidence: 0.4 }, sugerencias: ['B', 'B1'] },
    ]);
  });

  it('sin zonas no llama al modelo', async () => {
    const llm: any = { complete: jest.fn() };
    const svc = new VisionRetryService(
      { get: () => undefined } as any,
      {} as any,
      llm,
    );
    expect(await svc.readZones(new Uint8Array([1]), [])).toEqual([]);
    expect(llm.complete).not.toHaveBeenCalled();
  });
});
