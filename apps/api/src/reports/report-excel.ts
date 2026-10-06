import ExcelJS from 'exceljs';
import type { ReportEstado } from './report-extraction';

export interface ExcelRow {
  threadId: string;
  subject: string;
  estado: ReportEstado;
  novedad: boolean;
  novedadTexto: string;
  desactualizado: boolean;
  extraccionOk: boolean;
  data: Record<string, string>;
  actualizadoEn: Date | null;
}

/** Evento de la bitácora (hoja «Eventos»). */
export interface ExcelEvent {
  threadId: string;
  fechaEvento: Date;
  /** 'YYYY-MM-DD' en la zona del reporte */
  fecha: string;
  estado: string;
  novedadTexto: string;
  data: Record<string, string>;
  createdAt: Date;
}

export interface ExcelInput {
  fecha: string;
  generadoEn: string;
  trigger: string;
  columnas: string[];
  rows: ExcelRow[];
  /** Eventos de todos los hilos; sin ellos la hoja «Eventos» sale solo con encabezados. */
  eventos?: ExcelEvent[];
  webOrigin: string;
  totales: {
    hospitalizados: number;
    conNovedad: number;
    altas: number;
  };
  /** Formatea una fecha en la zona del reporte (por defecto ISO). */
  formatDate?: (d: Date) => string;
}

export const SHEET_SUMMARY = 'Resumen del día';
export const SHEET_PATIENTS = 'Pacientes';
export const SHEET_EVENTS = 'Eventos';
export const EVENT_FIXED_HEADERS = [
  'Fecha del evento',
  'Estado',
  'Qué cambió',
  'Registrado el',
  'Enlace al ticket',
];
const ESTADO_EVENTO: Record<string, string> = {
  hospitalizado: 'Hospitalizado',
  alta: 'Alta',
  otro: 'Otro',
};
export const FIXED_HEADERS = [
  'Novedad',
  'Qué cambió',
  'Estatus',
  'Última actualización',
  'Enlace al ticket',
];

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F3A5F' },
};
const NOVEDAD_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFE699' },
};
const HOY_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFDDEBF7' },
};
const ALTA_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFC6E0B4' },
};

function styleHeader(row: ExcelJS.Row) {
  row.height = 28;
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = HEADER_FILL;
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
  });
}

export function estatusTexto(r: ExcelRow): string {
  const base = !r.extraccionOk
    ? 'Extracción incompleta (revisar el ticket)'
    : r.estado === 'alta'
      ? 'Alta'
      : 'Hospitalizado';
  return r.desactualizado
    ? `${base} · Resumen desactualizado: hay mensajes sin analizar`
    : base;
}

/** Arma el .xlsx del reporte diario. Sin I/O: devuelve el contenido. */
export async function buildReportWorkbook(i: ExcelInput): Promise<Buffer> {
  const fmt =
    i.formatDate ??
    ((d: Date) => d.toISOString().slice(0, 16).replace('T', ' '));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'auto-med';
  wb.created = new Date();

  // ---- Resumen del día ----
  const eventos = [...(i.eventos ?? [])].sort(
    (a, b) =>
      b.fechaEvento.getTime() - a.fechaEvento.getTime() ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const eventosHoy = eventos.filter((e) => e.fecha === i.fecha).length;
  const s = wb.addWorksheet(SHEET_SUMMARY);
  s.columns = [{ width: 34 }, { width: 28 }];
  s.addRow(['Reporte de pacientes hospitalizados']).font = {
    bold: true,
    size: 16,
  };
  s.addRow([]);
  const lines: [string, string | number][] = [
    ['Fecha del reporte', i.fecha],
    ['Generado', i.generadoEn],
    ['Origen', i.trigger === 'programado' ? 'Programado' : 'Manual'],
    ['Pacientes hospitalizados', i.totales.hospitalizados],
    ['Con novedad', i.totales.conNovedad],
    ['Altas (primera vez)', i.totales.altas],
    ['Eventos registrados', `${eventos.length} (hoy: ${eventosHoy})`],
  ];
  for (const [k, v] of lines) {
    const r = s.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { horizontal: 'left' };
  }

  // ---- Pacientes ----
  const p = wb.addWorksheet(SHEET_PATIENTS);
  const headers = [...FIXED_HEADERS, ...i.columnas];
  p.addRow(headers);
  styleHeader(p.getRow(1));
  p.columns = headers.map((h, idx) => ({
    width:
      idx === 0
        ? 11
        : idx === 1
          ? 38
          : idx === 2
            ? 30
            : idx === 3
              ? 20
              : idx === 4
                ? 16
                : Math.min(40, Math.max(18, h.length + 6)),
  }));
  const first = i.columnas[0];
  for (const r of i.rows) {
    const data: Record<string, string> = { ...r.data };
    // Extracción fallida: el asunto del ticket ocupa la primera columna para poder identificarlo.
    if (!r.extraccionOk && first) data[first] = r.subject;
    const values: ExcelJS.CellValue[] = [
      r.novedad ? 'Sí' : 'No',
      r.novedadTexto,
      estatusTexto(r),
      r.actualizadoEn ? fmt(r.actualizadoEn) : '',
      {
        text: 'Abrir ticket',
        hyperlink: `${i.webOrigin.replace(/\/+$/, '')}/tickets/${r.threadId}`,
      },
      ...i.columnas.map((c) => data[c] ?? ''),
    ];
    const row = p.addRow(values);
    row.alignment = { vertical: 'top', wrapText: true };
    const nov = row.getCell(1);
    nov.alignment = { vertical: 'top', horizontal: 'center' };
    if (r.novedad) {
      nov.fill = NOVEDAD_FILL;
      nov.font = { bold: true };
    }
    if (r.estado === 'alta') row.getCell(3).fill = ALTA_FILL;
    row.getCell(5).font = { color: { argb: 'FF0563C1' }, underline: true };
  }
  p.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  p.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };

  // ---- Eventos (bitácora acumulativa de todos los hilos) ----
  const ev = wb.addWorksheet(SHEET_EVENTS);
  const extra: string[] = [];
  for (const e of eventos)
    for (const k of Object.keys(e.data))
      if (!i.columnas.includes(k) && !extra.includes(k)) extra.push(k);
  // Columnas vigentes primero; las que ya no están en la plantilla se conservan al final.
  const evCols = [...i.columnas, ...extra];
  const evHeaders = [...EVENT_FIXED_HEADERS, ...evCols];
  ev.addRow(evHeaders);
  styleHeader(ev.getRow(1));
  ev.columns = evHeaders.map((h, idx) => ({
    width:
      [18, 14, 40, 20, 16][idx] ?? Math.min(40, Math.max(18, h.length + 6)),
  }));
  const base = i.webOrigin.replace(/\/+$/, '');
  for (const e of eventos) {
    const row = ev.addRow([
      fmt(e.fechaEvento),
      ESTADO_EVENTO[e.estado] ?? e.estado,
      e.novedadTexto,
      fmt(e.createdAt),
      { text: 'Abrir ticket', hyperlink: `${base}/tickets/${e.threadId}` },
      ...evCols.map((c) => e.data[c] ?? ''),
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    if (e.fecha === i.fecha)
      row.eachCell({ includeEmpty: true }, (c) => {
        c.fill = HOY_FILL;
      });
    if (e.estado === 'alta') row.getCell(2).fill = ALTA_FILL;
    row.getCell(5).font = { color: { argb: 'FF0563C1' }, underline: true };
  }
  ev.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  ev.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: evHeaders.length },
  };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
