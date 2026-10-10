import { createCanvas } from '@napi-rs/canvas';
import {
  parseVisionReading,
  VisionRetryService,
  VISION_SYSTEM,
} from './vision-retry.service';

describe('parseVisionReading', () => {
  it('lee JSON dentro de texto/markdown', () => {
    expect(
      parseVisionReading('```json\n{"text":" Hola ","confidence":0.93}\n```'),
    ).toEqual({ text: 'Hola', confidence: 0.93 });
  });

  it('acota la confianza a 0..1', () => {
    expect(parseVisionReading('{"text":"a","confidence":7}')?.confidence).toBe(
      1,
    );
  });

  it('devuelve null con respuesta vacía, inválida o sin texto', () => {
    expect(parseVisionReading('')).toBeNull();
    expect(parseVisionReading('no sé')).toBeNull();
    expect(parseVisionReading('{"text":"","confidence":1}')).toBeNull();
    expect(parseVisionReading('{"text":"a"}')).toBeNull();
  });

  it('descarta una lectura que contiene [ilegible] (la región sigue dudosa)', () => {
    expect(
      parseVisionReading('{"text":"Dx: [ilegible] aguda","confidence":0.95}'),
    ).toBeNull();
  });
});

describe('VisionRetryService.reread y ámbito', () => {
  async function run(visionAmbito: string) {
    const llm: any = {
      vision: jest.fn().mockResolvedValue('{"text":"HTA","confidence":0.9}'),
    };
    const ocrSettings: any = {
      getEffective: jest.fn().mockResolvedValue({ visionAmbito }),
    };
    const svc = new VisionRetryService(
      { get: () => undefined } as any,
      ocrSettings,
      llm,
    );
    const png = createCanvas(100, 100).toBuffer('image/png');
    await svc.reread(new Uint8Array(png), { x: 0, y: 0, w: 0.5, h: 0.5 }, 'xx');
    return llm.vision.mock.calls[0];
  }

  it('sin ámbito el system es VISION_SYSTEM tal cual', async () => {
    const [, , opts] = await run('');
    expect(opts.system).toBe(VISION_SYSTEM);
  });

  it('con ámbito lo añade al final y la regla fija de respaldo sigue presente', async () => {
    const [, , opts] = await run('Notas médicas manuscritas');
    expect(opts.system.startsWith(VISION_SYSTEM)).toBe(true);
    expect(opts.system).toContain(
      'ÁMBITO Y CONTEXTO (indicado por el usuario)',
    );
    expect(opts.system).toContain('Notas médicas manuscritas');
    expect(VISION_SYSTEM).toMatch(/la imagen\s+no lo respalda/);
    expect(VISION_SYSTEM).toMatch(/escribe \[ilegible\]/);
  });
});
