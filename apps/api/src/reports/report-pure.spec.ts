import { buildReportPrompt, parseExtraction } from './report-extraction';
import { computeNovedad } from './report-novedad';
import { isDue, isValidHour, isValidZone, localParts } from './report-time';

const cols = [
  { nombre: 'Paciente', instruccion: 'Nombre' },
  { nombre: 'Hospital', instruccion: 'Hospital' },
];

describe('parseExtraction', () => {
  it('acepta JSON con texto o bloque de código alrededor y completa columnas faltantes', () => {
    const r = parseExtraction(
      'Claro:\n```json\n{"estado":"Hospitalizado","novedad_texto":"Ingresó","columnas":{"Paciente":"Ana","Extra":"x"}}\n```',
      cols,
    );
    expect(r).toEqual({
      estado: 'hospitalizado',
      novedadTexto: 'Ingresó',
      data: { Paciente: 'Ana', Hospital: '' },
    });
  });
  it('normaliza estados y valores no textuales', () => {
    const r = parseExtraction(
      '{"estado":"ALTA","columnas":{"Paciente":["a","b"],"Hospital":3}}',
      cols,
    );
    expect(r?.estado).toBe('alta');
    expect(r?.data).toEqual({ Paciente: 'a; b', Hospital: '3' });
  });
  it.each([
    'no es json',
    '{"estado":"quizá","columnas":{}}',
    '{"estado":"alta"}',
    '{"estado":"alta","columnas":[]}',
    '{roto',
    '[]',
  ])('devuelve null con %s', (raw) => {
    expect(parseExtraction(raw, cols)).toBeNull();
  });
  it('el prompt lleva las columnas y la síntesis', () => {
    const p = buildReportPrompt('SINTESIS', cols);
    expect(p).toContain('"Paciente": Nombre');
    expect(p).toContain('SINTESIS');
    expect(buildReportPrompt('S', cols, true)).toContain(
      'no fue un JSON válido',
    );
  });
});

describe('computeNovedad', () => {
  const base = {
    synthesisId: 's2',
    estado: 'hospitalizado' as const,
    novedadTexto: 'Llegó carta',
    data: { Paciente: 'Ana', Hospital: 'H2' },
  };
  it('hilo nuevo => novedad', () => {
    const r = computeNovedad({ ...base, previous: null });
    expect(r.novedad).toBe(true);
    expect(r.texto).toContain('nuevo');
  });
  it('misma síntesis y mismo estado => sin novedad', () => {
    const r = computeNovedad({
      ...base,
      previous: { synthesisId: 's2', estado: 'hospitalizado', data: base.data },
    });
    expect(r).toEqual({ novedad: false, texto: '' });
  });
  it('síntesis distinta => novedad con las columnas que cambiaron', () => {
    const r = computeNovedad({
      ...base,
      previous: {
        synthesisId: 's1',
        estado: 'hospitalizado',
        data: { Paciente: 'Ana', Hospital: 'H1' },
      },
    });
    expect(r.novedad).toBe(true);
    expect(r.texto).toContain('Cambió: Hospital');
    expect(r.texto).toContain('Llegó carta');
  });
  it('cambio de estado a alta => novedad', () => {
    const r = computeNovedad({
      ...base,
      estado: 'alta',
      previous: { synthesisId: 's2', estado: 'hospitalizado', data: base.data },
    });
    expect(r.novedad).toBe(true);
    expect(r.texto).toContain('Alta');
  });
});

describe('report-time', () => {
  it('calcula fecha y hora locales en la zona (cruce de día)', () => {
    const d = new Date('2026-10-07T04:30:00Z'); // 22:30 del día 6 en Ciudad de México (UTC-6)
    expect(localParts(d, 'America/Mexico_City')).toEqual({
      fecha: '2026-10-06',
      hora: '22:30',
    });
    expect(localParts(d, 'UTC')).toEqual({
      fecha: '2026-10-07',
      hora: '04:30',
    });
  });
  it('isDue compara contra la hora local', () => {
    const d = new Date('2026-10-06T13:00:00Z'); // 07:00 CDMX
    expect(isDue(d, 'America/Mexico_City', '07:00')).toBe(true);
    expect(isDue(d, 'America/Mexico_City', '07:01')).toBe(false);
  });
  it('valida hora y zona', () => {
    expect(isValidHour('07:05')).toBe(true);
    expect(isValidHour('7:5')).toBe(false);
    expect(isValidHour('24:00')).toBe(false);
    expect(isValidZone('America/Mexico_City')).toBe(true);
    expect(isValidZone('Marte/Olimpo')).toBe(false);
  });
});
