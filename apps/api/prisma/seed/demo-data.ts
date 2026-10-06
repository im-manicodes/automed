import {
  DEMO_ACCOUNT_EMAIL,
  DEMO_ACCOUNT_ID,
  DEMO_PREFIX,
  DEMO_S3_PREFIX,
  DEMO_SUBJECT_PREFIX,
} from './demo-constants';
import { pageKey, pdfKey } from '../../src/storage/storage-keys';

/** Datos FICTICIOS para probar la UI. Puro: no toca BD ni red. Todo id empieza por `demo-`. */

type Status =
  | 'sin_analizar'
  | 'pendiente'
  | 'procesando'
  | 'listo'
  | 'necesita_revision'
  | 'error';

export interface DemoLine {
  text: string;
  /** Caja normalizada 0..1 */
  x: number;
  y: number;
  w: number;
  h: number;
  status: 'ok' | 'dudoso' | 'corregido';
  confidence: number;
  userText?: string;
}

export interface DemoPage {
  id: string;
  attachmentId: string;
  pageNumber: number;
  imageKey: string;
  width: number;
  height: number;
  lines: DemoLine[];
}

export interface DemoDataset {
  template: Record<string, unknown>;
  account: Record<string, unknown>;
  threads: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  attachments: Record<string, unknown>[];
  pages: DemoPage[];
  regions: Record<string, unknown>[];
  syntheses: Record<string, unknown>[];
}

const PAGE_W = 1240;
const PAGE_H = 1754;
const ME = 'yo@demo.invalid';
const ANA = 'ana.demo@demo.invalid';
const PROV = 'proveedor@demo.invalid';

const ago = (now: Date, hours: number) =>
  new Date(now.getTime() - hours * 3_600_000);

/** Genera líneas de texto con cajas plausibles (columna a la izquierda, alto fijo). */
function lines(
  texts: string[],
  marks: Record<number, Partial<DemoLine>> = {},
): DemoLine[] {
  return texts.map((text, i) => ({
    text,
    x: 0.08,
    y: 0.1 + i * 0.055,
    w: Math.min(0.84, 0.014 * text.length + 0.05),
    h: 0.036,
    status: 'ok' as const,
    confidence: 0.93 + (i % 5) * 0.012,
    ...marks[i],
  }));
}

const SYNTH_FULL = (titulo: string) => `# Asunto
${DEMO_SUBJECT_PREFIX} ${titulo}

## Resumen ejecutivo
Datos ficticios de demostración; no corresponden a ningún correo real.

## Línea de tiempo
- **Día 1** — Proveedor — envía la propuesta inicial.
- **Día 2** — Yo — pido ajustes al monto.

## Acciones pendientes
| Acción | Responsable | Fecha límite |
|---|---|---|
| Confirmar monto | Yo | No indicado |
`;

const SYNTH_INCR = (titulo: string) =>
  SYNTH_FULL(titulo) +
  `
## Novedades
- **Día 3** — Proveedor — responde con el monto corregido (actualización incremental de demostración).
`;

export function buildDemoDataset(now: Date = new Date()): DemoDataset {
  const d = (s: string) => `${DEMO_PREFIX}${s}`;
  const messages: DemoDataset['messages'] = [];
  const attachments: DemoDataset['attachments'] = [];
  const pages: DemoPage[] = [];
  const regions: DemoDataset['regions'] = [];
  const syntheses: DemoDataset['syntheses'] = [];
  const threads: DemoDataset['threads'] = [];

  const addThread = (
    n: string,
    title: string,
    status: Status,
    extra: { seguimiento?: boolean; tieneMensajesNuevos?: boolean } = {},
    lastHoursAgo = 5,
  ) => {
    threads.push({
      id: d(`hilo-${n}`),
      accountId: DEMO_ACCOUNT_ID,
      conversationId: d(`conv-${n}`),
      subject: `${DEMO_SUBJECT_PREFIX} ${title}`,
      status,
      seguimiento: extra.seguimiento ?? false,
      tieneMensajesNuevos: extra.tieneMensajesNuevos ?? false,
      contentHash: d(`hash-${n}`),
      lastMessageAt: ago(now, lastHoursAgo),
    });
    return d(`hilo-${n}`);
  };

  const addMsg = (
    n: string,
    i: number,
    fromMe: boolean,
    hoursAgo: number,
    body: string,
    threadTitle: string,
  ) => {
    const id = d(`msg-${n}-${i}`);
    messages.push({
      id,
      threadId: d(`hilo-${n}`),
      graphId: d(`graph-${n}-${i}`),
      from: fromMe ? ME : i % 2 ? PROV : ANA,
      to: fromMe ? [PROV] : [ME],
      cc: i === 3 ? [ANA] : [],
      subject: `${fromMe || i > 1 ? 'RE: ' : ''}${DEMO_SUBJECT_PREFIX} ${threadTitle}`,
      bodyText: `[DEMO] ${body} (texto ficticio de demostración)`,
      isFromMe: fromMe,
      receivedAt: ago(now, hoursAgo),
    });
    return id;
  };

  const addPdf = (
    n: string,
    msgIdx: number,
    letter: string,
    filename: string,
    status: Status,
    pageSpecs: DemoLine[][] = [],
  ) => {
    const attId = d(`adj-${n}${letter}`);
    const threadId = d(`hilo-${n}`);
    const pdfIdx =
      attachments.filter((a) => String(a.messageId).startsWith(d(`msg-${n}-`)))
        .length + 1;
    attachments.push({
      id: attId,
      messageId: d(`msg-${n}-${msgIdx}`),
      graphId: d(`graphadj-${n}${letter}`),
      filename: `demo-${filename}`,
      mimeType: 'application/pdf',
      size: 48_000 + pageSpecs.length * 1_000,
      storageKey: pdfKey(threadId, pdfIdx, DEMO_S3_PREFIX),
      sha256: d(`sha-${n}${letter}`),
      status,
    });
    pageSpecs.forEach((ls, k) => {
      const pageNumber = k + 1;
      const pageId = d(`pag-${n}${letter}-${pageNumber}`);
      pages.push({
        id: pageId,
        attachmentId: attId,
        pageNumber,
        imageKey: pageKey(pdfKey(threadId, pdfIdx, DEMO_S3_PREFIX), pageNumber),
        width: PAGE_W,
        height: PAGE_H,
        lines: ls,
      });
      ls.forEach((l, j) => {
        regions.push({
          id: d(`reg-${n}${letter}-${pageNumber}-${j + 1}`),
          pageId,
          x: l.x,
          y: l.y,
          w: l.w,
          h: l.h,
          text: l.text,
          confidence: l.confidence,
          status: l.status,
          userText: l.userText ?? null,
          source: l.status === 'corregido' ? 'usuario' : 'ocr',
        });
      });
    });
    return attId;
  };

  const addSynth = (
    n: string,
    version: number,
    title: string,
    covered: string[],
    mode: 'full' | 'incremental',
    base: string | null,
    tplVersion: number,
  ) => {
    const id = d(`sint-${n}-${version}`);
    syntheses.push({
      id,
      threadId: d(`hilo-${n}`),
      version,
      markdown: mode === 'full' ? SYNTH_FULL(title) : SYNTH_INCR(title),
      inputHash: d(`inhash-${n}-${version}`),
      model: 'demo-modelo',
      templateId: d('plantilla-antigua'),
      templateVersion: tplVersion,
      coveredMessageIds: covered,
      mode,
      baseSynthesisId: base,
      inputTokensEstimados: mode === 'full' ? 4200 : 900,
    });
    return id;
  };

  // 1) sin_analizar: un PDF sin OCR
  const t1 = 'Cotización de equipo médico (sin analizar)';
  addThread('1', t1, 'sin_analizar', {}, 2);
  addMsg('1', 1, false, 3, 'Adjunto la cotización solicitada.', t1);
  addMsg('1', 2, true, 2, 'Gracias, la reviso.', t1);
  addPdf('1', 1, 'a', 'cotizacion-equipo.pdf', 'sin_analizar');

  // 2) procesando
  const t2 = 'Contrato de mantenimiento (procesando)';
  addThread('2', t2, 'procesando', {}, 4);
  addMsg('2', 1, false, 5, 'Va el contrato firmado.', t2);
  addPdf('2', 1, 'a', 'contrato-mantenimiento.pdf', 'procesando');
  addPdf('2', 1, 'b', 'anexo-tecnico.pdf', 'pendiente');

  // 3) listo: síntesis completa + incremental, plantilla desactualizada, varios PDF
  const t3 = 'Orden de compra 4501 (listo)';
  addThread('3', t3, 'listo', {}, 8);
  const m31 = addMsg(
    '3',
    1,
    false,
    72,
    'Envío la orden de compra y la factura.',
    t3,
  );
  const m32 = addMsg('3', 2, true, 60, 'Recibido, ajusto el monto.', t3);
  const m33 = addMsg(
    '3',
    3,
    false,
    8,
    'Monto corregido en el PDF adjunto.',
    t3,
  );
  const okLines = (extra: string) =>
    lines([
      'ORDEN DE COMPRA No. DEMO-4501',
      'Proveedor: Suministros Demo S.A.',
      'Fecha: 01/01/2026',
      extra,
      'Total: 1,250.00 MXN',
    ]);
  addPdf('3', 1, 'a', 'orden-compra-4501.pdf', 'listo', [
    okLines('Concepto: Material de curación'),
    okLines('Condiciones: pago a 30 días'),
  ]);
  addPdf('3', 1, 'b', 'factura-demo-001.pdf', 'listo', [
    okLines('Factura FICTICIA 001'),
  ]);
  addPdf('3', 3, 'c', 'orden-compra-corregida.pdf', 'listo', [
    okLines('Monto corregido'),
  ]);
  const s31 = addSynth('3', 1, t3, [m31, m32], 'full', null, 0);
  addSynth('3', 2, t3, [m31, m32, m33], 'incremental', s31, 0);

  // 4) necesita_revision: regiones dudosas y corregidas
  const t4 = 'Receta y estudios del paciente DEMO (necesita revisión)';
  addThread('4', t4, 'necesita_revision', {}, 12);
  const m41 = addMsg('4', 1, false, 14, 'Adjunto estudios escaneados.', t4);
  const m42 = addMsg('4', 2, true, 13, 'Los reviso hoy.', t4);
  addPdf('4', 1, 'a', 'estudio-manuscrito.pdf', 'necesita_revision', [
    lines(
      [
        'HOJA DE INDICACIONES (DEMO)',
        'Paciente: Persona Ficticia',
        'Dosis: 5O mg cada 8 h',
        'Observaciones: reposo rel?tivo',
        'Firma: ilegible',
        'Próxima cita: 15 de marzo',
      ],
      {
        2: { status: 'dudoso', confidence: 0.52 },
        3: {
          status: 'corregido',
          confidence: 0.6,
          userText: 'Observaciones: reposo relativo',
        },
        4: { status: 'dudoso', confidence: 0.31 },
      },
    ),
    lines(['Segunda página (DEMO)', 'Peso: 7O kg', 'Notas sin importancia'], {
      1: { status: 'dudoso', confidence: 0.68 },
    }),
  ]);
  addPdf('4', 2, 'b', 'laboratorio.pdf', 'listo', [
    lines(['LABORATORIO DEMO', 'Glucosa: 98 mg/dl', 'Colesterol: 180 mg/dl']),
  ]);
  addSynth('4', 1, t4, [m41, m42], 'full', null, 0);

  // 5) error
  const t5 = 'PDF dañado (error)';
  addThread('5', t5, 'error', {}, 20);
  addMsg('5', 1, false, 21, 'Mando el reporte.', t5);
  addPdf('5', 1, 'a', 'reporte-corrupto.pdf', 'error');

  // 6) listo con mensajes nuevos
  const t6 = 'Seguimiento de entrega (mensajes nuevos)';
  addThread('6', t6, 'listo', { tieneMensajesNuevos: true }, 1);
  const m61 = addMsg('6', 1, false, 30, 'Confirmo la fecha de entrega.', t6);
  addMsg('6', 2, false, 1, 'Cambió la fecha de entrega.', t6);
  addPdf('6', 1, 'a', 'entrega.pdf', 'listo', [
    lines(['ENTREGA DEMO', 'Fecha: 10/02/2026']),
  ]);
  addSynth('6', 1, t6, [m61], 'full', null, 0);

  // 7) listo con seguimiento activo
  const t7 = 'Proyecto de remodelación (seguimiento activo)';
  addThread('7', t7, 'listo', { seguimiento: true }, 6);
  const m71 = addMsg('7', 1, false, 7, 'Planos aprobados.', t7);
  const m72 = addMsg('7', 2, true, 6, 'Excelente, avanzamos.', t7);
  addPdf('7', 1, 'a', 'planos.pdf', 'listo', [
    lines(['PLANOS DEMO', 'Escala 1:50']),
  ]);
  addSynth('7', 1, t7, [m71, m72], 'full', null, 0);

  return {
    template: {
      id: d('plantilla-antigua'),
      name: '[DEMO] Plantilla antigua',
      kind: 'resumen',
      version: 0,
      markdown:
        '# Asunto\n<!-- Plantilla antigua de demostración. -->\n\n## Resumen\n',
      isActive: false,
    },
    account: {
      id: DEMO_ACCOUNT_ID,
      email: DEMO_ACCOUNT_EMAIL,
      userId: null,
      tokenEnc: null,
    },
    threads,
    messages,
    attachments,
    pages,
    regions,
    syntheses,
  };
}

export const DEMO_PAGE_SIZE = { width: PAGE_W, height: PAGE_H };
