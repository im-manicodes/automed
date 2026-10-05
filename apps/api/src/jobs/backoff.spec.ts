import { backoffMs } from './backoff';

describe('backoffMs', () => {
  it('crece exponencialmente desde la base', () => {
    expect(backoffMs(1, 1000)).toBe(1000);
    expect(backoffMs(2, 1000)).toBe(2000);
    expect(backoffMs(3, 1000)).toBe(4000);
    expect(backoffMs(5, 1000)).toBe(16000);
  });
  it('respeta el tope', () => {
    expect(backoffMs(20, 1000, 60_000)).toBe(60_000);
  });
  it('trata intentos < 1 como el primero', () => {
    expect(backoffMs(0, 500)).toBe(500);
  });
});
