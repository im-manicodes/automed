import {
  confidenceLevel,
  flagLowConfidencePage,
  pageConfidence,
} from './ocr-confidence';

const r = (
  text: string,
  confidence: number,
  extra: { status?: 'ok' | 'dudoso'; userText?: string } = {},
) => ({
  text,
  confidence,
  status: 'ok' as 'ok' | 'dudoso',
  ...extra,
});

describe('confidenceLevel', () => {
  it('clasifica por rangos y null es digital', () => {
    expect(confidenceLevel(null)).toBe('digital');
    expect(confidenceLevel(0.95)).toBe('alta');
    expect(confidenceLevel(0.9)).toBe('alta');
    expect(confidenceLevel(0.8)).toBe('media');
    expect(confidenceLevel(0.75)).toBe('media');
    expect(confidenceLevel(0.6)).toBe('baja');
  });
});

describe('pageConfidence', () => {
  it('pondera por el largo del texto', () => {
    expect(pageConfidence([r('aaaa', 1), r('b', 0)])).toBeCloseTo(0.8);
  });
  it('una región corregida cuenta como 1', () => {
    expect(pageConfidence([r('xx', 0.2, { userText: 'ok' })])).toBe(1);
  });
  it('sin regiones es null', () => {
    expect(pageConfidence([])).toBeNull();
  });
});

describe('flagLowConfidencePage', () => {
  it('página pobre sin dudosas: marca las más débiles', () => {
    const out = flagLowConfidencePage([
      r('aaaa', 0.7),
      r('bbbb', 0.6),
      r('cccc', 0.9),
    ]);
    expect(out.map((x) => x.status)).toEqual(['dudoso', 'dudoso', 'ok']);
  });
  it('respeta el tope de 10', () => {
    const lines = Array.from({ length: 30 }, (_, i) =>
      r('texto', 0.5 + i * 0.001),
    );
    expect(
      flagLowConfidencePage(lines).filter((x) => x.status === 'dudoso'),
    ).toHaveLength(10);
  });
  it('no toca páginas buenas ni las que ya tienen dudosas', () => {
    const buena = [r('aaaa', 0.9), r('bbbb', 0.85)];
    expect(flagLowConfidencePage(buena)).toBe(buena);
    const conDudosa = [
      r('aaaa', 0.3, { status: 'dudoso' as const }),
      r('bbbb', 0.5),
    ];
    expect(flagLowConfidencePage(conDudosa)).toBe(conDudosa);
  });
});
