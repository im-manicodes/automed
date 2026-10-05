import { parseVisionReading } from './vision-retry.service';

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
});
