import { crearBorradores, textoEnviable, textoInicial, type AlmacenBorrador } from './borrador';

describe('borradores', () => {
  it('guarda en memoria y almacenamiento', () => {
    const datos = new Map<string, string>();
    const alm: AlmacenBorrador = {
      getItem: (k) => datos.get(k) ?? null,
      setItem: (k, v) => void datos.set(k, v),
      removeItem: (k) => void datos.delete(k),
    };
    const b = crearBorradores(alm);
    b.guardar('r1', 'hola');
    expect(b.leer('r1')).toBe('hola');
    expect(crearBorradores(alm).leer('r1')).toBe('hola');
    b.borrar('r1');
    expect(b.leer('r1')).toBeUndefined();
  });
  it('tolera un almacenamiento que lanza', () => {
    const roto: AlmacenBorrador = {
      getItem: () => { throw new Error('x'); },
      setItem: () => { throw new Error('x'); },
      removeItem: () => { throw new Error('x'); },
    };
    const b = crearBorradores(roto);
    expect(() => b.guardar('r', 'a')).not.toThrow();
    expect(b.leer('r')).toBe('a');
    expect(() => b.borrar('r')).not.toThrow();
    expect(crearBorradores(roto).leer('otro')).toBeUndefined();
  });
  it('prioriza borrador > guardado > sugerencia', () => {
    expect(textoInicial('b', 'g', 's')).toBe('b');
    expect(textoInicial(undefined, 'g', 's')).toBe('g');
    expect(textoInicial(undefined, null, 's')).toBe('s');
  });
  it('valida el texto enviable', () => {
    expect(textoEnviable('  ')).toBeNull();
    expect(textoEnviable(' hola ')).toBe('hola');
    expect(textoEnviable('x'.repeat(2001))).toBeNull();
  });
});
