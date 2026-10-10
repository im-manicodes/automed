import {
  DEFAULT_INSTRUCCIONES,
  DEFAULT_VISION_AMBITO,
  MAX_INSTRUCCIONES,
  validateScopeText,
  withScope,
} from './template-instructions';

describe('withScope', () => {
  it('con texto vacío o en blanco devuelve el system intacto', () => {
    expect(withScope('SYS', '')).toBe('SYS');
    expect(withScope('SYS', '   ')).toBe('SYS');
    expect(withScope('SYS', null)).toBe('SYS');
    expect(withScope('SYS', undefined)).toBe('SYS');
  });

  it('con texto añade el bloque al final con la nota fija', () => {
    const out = withScope('SYS', ' Hospital X ');
    expect(out.startsWith('SYS\n\n')).toBe(true);
    expect(out).toContain(
      'ÁMBITO Y CONTEXTO (indicado por el usuario)\nHospital X\n',
    );
    expect(out).toMatch(/solo orienta el tema y el vocabulario/);
  });
});

describe('textos por defecto y validación', () => {
  it('hay valor por defecto para cada tipo y para visión', () => {
    for (const k of ['resumen', 'whatsapp', 'reporte'] as const)
      expect(DEFAULT_INSTRUCCIONES[k].length).toBeGreaterThan(0);
    expect(DEFAULT_INSTRUCCIONES.reporte).toMatch(/No inventes/);
    expect(DEFAULT_VISION_AMBITO).toMatch(/clínicos/);
  });

  it('validateScopeText respeta el límite y el tipo', () => {
    expect(
      validateScopeText(
        'x'.repeat(MAX_INSTRUCCIONES),
        MAX_INSTRUCCIONES,
        'Ello',
      ),
    ).toBeNull();
    expect(
      validateScopeText(
        'x'.repeat(MAX_INSTRUCCIONES + 1),
        MAX_INSTRUCCIONES,
        'Ello',
      ),
    ).toMatch(/4000/);
    expect(validateScopeText(5, 10, 'Ello')).toMatch(/texto/);
  });
});
