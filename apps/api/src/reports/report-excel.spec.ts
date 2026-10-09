import ExcelJS from 'exceljs';
import {
  buildReportWorkbook,
  EVENT_FIXED_HEADERS,
  FIXED_HEADERS,
} from './report-excel';
import type { ExcelEvent, ExcelRow } from './report-excel';

const cell = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
const row = (o: Partial<ExcelRow>): ExcelRow => ({
  threadId: 't1',
  subject: 'Asunto',
  estado: 'hospitalizado',
  novedad: false,
  novedadTexto: '',
  desactualizado: false,
  extraccionOk: true,
  data: { Paciente: 'Ana', Hospital: 'H1' },
  actualizadoEn: new Date('2026-10-06T12:00:00Z'),
  ...o,
});

describe('buildReportWorkbook', () => {
  it('genera hojas, columnas fijas + de plantilla, estilos, filtros y enlaces', async () => {
    const buf = await buildReportWorkbook({
      fecha: '2026-10-06',
      generadoEn: '2026-10-06 07:00',
      trigger: 'manual',
      columnas: ['Paciente', 'Hospital'],
      rows: [
        row({ novedad: true, novedadTexto: 'Paciente nuevo' }),
        row({
          threadId: 't2',
          estado: 'alta',
          novedad: true,
          data: { Paciente: 'Luis', Hospital: 'H2' },
        }),
        row({
          threadId: 't3',
          extraccionOk: false,
          estado: 'otro',
          data: {},
          subject: 'Asunto roto',
        }),
        row({ threadId: 't4', desactualizado: true }),
      ],
      webOrigin: 'http://localhost:8080/',
      totales: { hospitalizados: 2, conNovedad: 2, altas: 1 },
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Resumen del día',
      'Pacientes',
      'Eventos',
    ]);

    const p = wb.getWorksheet('Pacientes')!;
    expect(p.getRow(1).values).toEqual([
      undefined,
      'Paciente',
      'Hospital',
      ...FIXED_HEADERS,
    ]);
    const h1 = p.getRow(1).getCell(1);
    expect(h1.font).toMatchObject({
      name: 'Arial Narrow',
      size: 10,
      bold: true,
    });
    expect(JSON.stringify(h1.fill)).toContain('FF2F8A6C');
    expect(h1.alignment?.wrapText).toBe(true);
    expect(p.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(p.autoFilter).toBeTruthy();
    expect(p.rowCount).toBe(5);
    // Novedad resaltada solo cuando es "Sí"
    const NOV = 3;
    expect(p.getRow(2).getCell(NOV).value).toBe('Sí');
    expect(p.getRow(2).getCell(NOV).fill).toMatchObject({ type: 'pattern' });
    expect(p.getRow(5).getCell(NOV).value).toBe('No');
    expect(JSON.stringify(p.getRow(5).getCell(NOV).fill)).not.toContain(
      'FFFFE699',
    );
    expect(JSON.stringify(p.getRow(2).getCell(NOV).fill)).toContain('FFFFE699');
    expect(p.getRow(3).getCell(NOV + 2).value).toBe('Alta');
    // enlace al ticket
    const link = p.getRow(2).getCell(7).value as ExcelJS.CellHyperlinkValue;
    expect(link.hyperlink).toBe('http://localhost:8080/tickets/t1');
    // ajuste de texto
    expect(p.getRow(2).getCell(1).alignment?.wrapText).toBe(true);
    expect(p.getRow(2).getCell(7).font?.underline).toBe(true);
    // extracción incompleta: estatus + asunto en la primera columna
    expect(cell(p.getRow(4).getCell(5).value)).toContain(
      'Extracción incompleta',
    );
    expect(p.getRow(4).getCell(1).value).toBe('Asunto roto');
    expect(cell(p.getRow(5).getCell(5).value)).toContain(
      'Resumen desactualizado',
    );

    const s = wb.getWorksheet('Resumen del día')!;
    const texts: string[] = [];
    s.eachRow((r) => texts.push(JSON.stringify(r.values)));
    expect(texts.join('\n')).toContain('Pacientes hospitalizados",2');
    expect(texts.join('\n')).toContain('2026-10-06');

    expect(texts.join('\n')).not.toContain('sin analizar');
  });

  describe('fechas y días de estancia', () => {
    const cols = [
      'FECHA DE INGRESO',
      'DIAS DE ESTANCIA HOSPITALARIA',
      'FECHA DE REPORTE DE LA GESTIÓN OPERATIVA Y/O EGRESO',
      'Nota',
    ];
    const build = async (rows: ExcelRow[]) => {
      const buf = await buildReportWorkbook({
        fecha: '2026-10-06',
        generadoEn: 'x',
        trigger: 'manual',
        columnas: cols,
        rows,
        webOrigin: 'http://web',
        totales: { hospitalizados: 0, conNovedad: 0, altas: 0 },
      });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      return wb.getWorksheet('Pacientes')!;
    };
    it('convierte fechas válidas y escribe fórmulas con letras reales', async () => {
      const p = await build([
        row({
          data: {
            [cols[0]]: '2026-10-01',
            [cols[1]]: '5 días',
            [cols[2]]: 'pendiente',
          },
        }),
        row({
          estado: 'alta',
          data: {
            [cols[0]]: '2026-10-01',
            [cols[1]]: '9',
            [cols[2]]: '2026-10-04',
          },
        }),
        row({
          data: { [cols[0]]: 'sin fecha', [cols[1]]: '3 días', [cols[3]]: 'x' },
        }),
      ]);
      const a = p.getRow(2);
      expect((a.getCell(1).value as Date).toISOString()).toContain(
        '2026-10-01',
      );
      expect(a.getCell(1).numFmt).toBe('yyyy-m-d');
      expect(a.getCell(3).value).toBe('pendiente');
      expect(a.getCell(2).value).toMatchObject({
        formula: '(TODAY()-A2)+1',
        result: 6,
      });
      expect(p.getRow(3).getCell(2).value).toMatchObject({
        formula: '(C3-A3)+1',
        result: 4,
      });
      // sin fecha de ingreso válida: queda el texto de la IA
      expect(p.getRow(4).getCell(1).value).toBe('sin fecha');
      expect(p.getRow(4).getCell(2).value).toBe('3 días');
    });
  });

  describe('hoja Eventos', () => {
    const ev = (o: Partial<ExcelEvent>): ExcelEvent => ({
      threadId: 't1',
      fechaEvento: new Date('2026-10-06T15:00:00Z'),
      fecha: '2026-10-06',
      estado: 'hospitalizado',
      novedadTexto: 'Mejora',
      data: { Paciente: 'Ana', Hospital: 'H1' },
      createdAt: new Date('2026-10-06T16:00:00Z'),
      ...o,
    });
    const build = async (eventos: ExcelEvent[]) => {
      const buf = await buildReportWorkbook({
        fecha: '2026-10-06',
        generadoEn: '2026-10-06 07:00',
        trigger: 'manual',
        columnas: ['Paciente', 'Hospital'],
        rows: [],
        eventos,
        webOrigin: 'http://web/',
        totales: { hospitalizados: 0, conNovedad: 0, altas: 0 },
      });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      return wb;
    };

    it('ordena por fecha desc, une columnas (antiguas al final), resalta hoy y enlaza', async () => {
      const wb = await build([
        ev({
          threadId: 'a',
          fecha: '2026-10-01',
          fechaEvento: new Date('2026-10-01T15:00:00Z'),
          data: { Paciente: 'Viejo', 'Columna vieja': 'dato' },
        }),
        ev({ threadId: 'b', estado: 'alta' }),
        ev({
          threadId: 'c',
          fecha: '2026-10-04',
          fechaEvento: new Date('2026-10-04T15:00:00Z'),
        }),
      ]);
      const s = wb.getWorksheet('Eventos')!;
      expect(s.getRow(1).values).toEqual([
        undefined,
        ...EVENT_FIXED_HEADERS,
        'Paciente',
        'Hospital',
        'Columna vieja',
      ]);
      expect(s.rowCount).toBe(4);
      const link = (r: number) => JSON.stringify(s.getRow(r).getCell(5).value);
      expect(link(2)).toContain('http://web/tickets/b');
      expect(link(3)).toContain('/tickets/c');
      expect(link(4)).toContain('/tickets/a');
      expect(s.getRow(2).getCell(2).value).toBe('Alta');
      expect(s.getRow(4).getCell(8).value).toBe('dato');
      expect(s.getRow(4).getCell(7).value).toBe('');
      const fill = (r: number) =>
        (s.getRow(r).getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb;
      expect(fill(2)).toBe('FFDDEBF7');
      expect(fill(3)).toBeUndefined();
      expect(fill(4)).toBeUndefined();
      expect(s.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(s.autoFilter).toBeTruthy();
    });

    it('el resumen cuenta eventos totales y de hoy; sin eventos solo hay encabezados', async () => {
      const wb = await build([
        ev({}),
        ev({ fecha: '2026-10-02' }),
        ev({ fecha: '2026-10-06' }),
      ]);
      const t: string[] = [];
      wb.getWorksheet('Resumen del día')!.eachRow((r) =>
        t.push(JSON.stringify(r.values)),
      );
      expect(t.join('\n')).toContain('Eventos registrados","3 (hoy: 2)"');
      const vacio = await build([]);
      expect(vacio.getWorksheet('Eventos')!.rowCount).toBe(1);
    });
  });
});
