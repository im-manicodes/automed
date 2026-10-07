import { evaluarHardware, parseNvidiaSmi } from './hardware.service';

describe('evaluarHardware', () => {
  it('RAM 4 GB: no apto, sin velocidad, motivo con la RAM', () => {
    const r = evaluarHardware({ ramGb: 4 });
    expect(r.apto).toBe(false);
    expect(r.velocidad).toBeNull();
    expect(r.motivo).toContain('4 GB');
  });

  it('RAM 4 GB con GPU grande sigue sin ser apto', () => {
    const r = evaluarHardware({
      ramGb: 4,
      gpu: { nombre: 'RTX', vramGb: 12 },
    });
    expect(r).toMatchObject({ apto: false, velocidad: null });
  });

  it('RAM 8 GB solo CPU: apto y lenta', () => {
    expect(evaluarHardware({ ramGb: 8 })).toMatchObject({
      apto: true,
      velocidad: 'lenta',
    });
  });

  it('RAM 16 GB con GPU >= 4 GB: rápida', () => {
    const r = evaluarHardware({
      ramGb: 16,
      gpu: { nombre: 'RTX 3050', vramGb: 4 },
    });
    expect(r).toMatchObject({ apto: true, velocidad: 'rapida' });
    expect(r.motivo).toContain('RTX 3050');
  });

  it('GPU con menos de 4 GB: lenta', () => {
    expect(
      evaluarHardware({ ramGb: 16, gpu: { nombre: 'x', vramGb: 2 } }),
    ).toMatchObject({ apto: true, velocidad: 'lenta' });
  });

  it('Apple Silicon con 16 GB: rápida; con 4 GB no apto', () => {
    expect(evaluarHardware({ ramGb: 16, appleSilicon: true })).toMatchObject({
      apto: true,
      velocidad: 'rapida',
    });
    expect(evaluarHardware({ ramGb: 4, appleSilicon: true }).apto).toBe(false);
  });
});

describe('parseNvidiaSmi', () => {
  it('lee nombre y VRAM en GB', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 3060, 12288\n')).toEqual({
      nombre: 'NVIDIA GeForce RTX 3060',
      vramGb: 12,
    });
  });
  it('salida vacía o rara -> undefined', () => {
    expect(parseNvidiaSmi('')).toBeUndefined();
    expect(parseNvidiaSmi('basura')).toBeUndefined();
    expect(parseNvidiaSmi('x, abc')).toBeUndefined();
  });
});
