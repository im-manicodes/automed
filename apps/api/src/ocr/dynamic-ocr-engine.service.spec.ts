import {
  DynamicOcrEngine,
  OCR_NOT_CONFIGURED_MESSAGE,
} from './dynamic-ocr-engine.service';

const page = { pageNumber: 1, words: [] };

function make(env: Record<string, string> = {}) {
  let eff: any = { motor: 'local', textractMode: 'detect', origen: 'servidor' };
  const settings = { getEffective: jest.fn(() => Promise.resolve(eff)) };
  const local = { recognize: jest.fn().mockResolvedValue(page) };
  const textract = { recognize: jest.fn().mockResolvedValue(page) };
  const engine = new DynamicOcrEngine(
    { get: (k: string) => env[k] } as never,
    settings as never,
    local as never,
    textract as never,
  );
  return {
    engine,
    local,
    textract,
    set: (e: any) => (eff = { ...eff, ...e }),
  };
}

const img = new Uint8Array([1]);

describe('DynamicOcrEngine', () => {
  it('elige el motor en cada llamada, sin reiniciar', async () => {
    const { engine, local, textract, set } = make({
      OCR_LOCAL_URL: 'http://l:9/',
    });
    await engine.recognize(img, 1);
    expect(local.recognize).toHaveBeenCalledWith(img, 1, {
      baseUrl: 'http://l:9',
    });
    expect(engine.name).toBe('local');
    set({ motor: 'textract', textractMode: 'analyze' });
    await engine.recognize(img, 2);
    expect(textract.recognize).toHaveBeenCalledWith(img, 2, {
      mode: 'analyze',
    });
    expect(engine.name).toBe('textract');
    set({ motor: 'local' });
    await engine.recognize(img, 3);
    expect(local.recognize).toHaveBeenCalledTimes(2);
  });

  it("con 'ninguno' lanza el error claro y no llama a ningún motor", async () => {
    const { engine, local, textract, set } = make();
    set({ motor: 'ninguno' });
    await expect(engine.recognize(img, 1)).rejects.toThrow(
      OCR_NOT_CONFIGURED_MESSAGE,
    );
    expect(OCR_NOT_CONFIGURED_MESSAGE).toBe(
      'Configura el OCR en Ajustes para leer páginas escaneadas.',
    );
    expect(local.recognize).not.toHaveBeenCalled();
    expect(textract.recognize).not.toHaveBeenCalled();
  });
});
