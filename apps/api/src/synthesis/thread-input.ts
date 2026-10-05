/** Construcción (pura) de la entrada del LLM a partir de un hilo: mensajes + OCR por página. */

export interface InputMessage {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  isFromMe: boolean;
  receivedAt: Date;
  attachments: { sha256: string; filename: string }[];
}

export interface InputRegion {
  x: number;
  y: number;
  text: string;
  status: 'ok' | 'dudoso' | 'corregido';
  userText: string | null;
}

export interface InputPage {
  pageNumber: number;
  text: string | null;
  regions: InputRegion[];
}

export interface InputBlock {
  kind: 'message' | 'document';
  text: string;
}

export interface BuiltInput {
  blocks: InputBlock[];
  /** Regiones dudosas aún sin corregir (marcadas [ilegible #n ...]). */
  doubtfulCount: number;
}

const MAX_BODY_CHARS = 8000;

const QUOTE_MARKERS: RegExp[] = [
  /^\s*-{2,}\s*(Original Message|Mensaje original|Forwarded message|Mensaje reenviado)\s*-{2,}/im,
  /^\s*_{5,}\s*$/m,
  /^\s*(De|From):\s.+\n\s*(Enviado|Sent|Date|Fecha)(\s+el)?:\s/im,
  /^\s*El\s.{5,120}\sescribi[óo]:\s*$/im,
  /^\s*On\s.{5,120}\swrote:\s*$/im,
  /^--\s*$/m, // firma estándar "-- "
];

/** Quita citas del hilo anterior, firmas y líneas ">" para no repetir contenido ya presente. */
export function cleanBody(raw: string): string {
  let text = raw.replace(/\r\n?/g, '\n');
  let cut = text.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  text = text.slice(0, cut);
  text = text
    .split('\n')
    .filter((l) => !/^\s*>/.test(l))
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > MAX_BODY_CHARS) {
    text = text.slice(0, MAX_BODY_CHARS) + '\n[... cuerpo recortado ...]';
  }
  return text;
}

function iso(d: Date) {
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export function formatMessage(m: InputMessage, index: number): string {
  const origin = m.isFromMe
    ? 'ENVIADO POR MÍ (propio)'
    : 'RECIBIDO (de otra persona)';
  const body = cleanBody(m.bodyText);
  const lines = [
    `### Mensaje ${index} · ${iso(m.receivedAt)} · ${origin}`,
    `De: ${m.from}`,
    `Para: ${m.to.join(', ') || '(sin destinatarios)'}`,
  ];
  if (m.cc.length) lines.push(`Cc: ${m.cc.join(', ')}`);
  lines.push(`Asunto: ${m.subject}`);
  if (m.attachments.length)
    lines.push(`Adjuntos: ${m.attachments.map((a) => a.filename).join(', ')}`);
  lines.push('', body || '(sin texto)');
  return lines.join('\n');
}

/** Texto vigente de una región: corrección del usuario > OCR; dudosa sin corregir -> null. */
export function regionText(r: InputRegion): string | null {
  if (r.userText && r.userText.trim() !== '') return r.userText.trim();
  if (r.status === 'dudoso') return null;
  return r.text;
}

/**
 * Texto de una página. Regiones en orden de lectura (y, luego x). `nextIllegible` entrega el
 * número consecutivo (#n) de cada marca. Sin regiones se usa el texto plano de la página.
 */
export function renderPage(
  page: InputPage,
  docName: string,
  nextIllegible: () => number,
): { text: string; doubtful: number } {
  if (page.regions.length === 0) {
    return { text: (page.text ?? '').trim(), doubtful: 0 };
  }
  const ordered = [...page.regions].sort((a, b) => a.y - b.y || a.x - b.x);
  let doubtful = 0;
  const lines = ordered.map((r) => {
    const t = regionText(r);
    if (t !== null) return t;
    doubtful++;
    return `[ilegible #${nextIllegible()} · ${docName} · p.${page.pageNumber}]`;
  });
  return { text: lines.join('\n'), doubtful };
}

export function buildInputBlocks(
  messages: InputMessage[],
  pagesBySha: Map<string, InputPage[]>,
): BuiltInput {
  const ordered = [...messages].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
  );
  const blocks: InputBlock[] = [];
  let counter = 0;
  let doubtfulCount = 0;
  const seen = new Map<string, string>();
  const next = () => ++counter;

  ordered.forEach((m, i) => {
    blocks.push({ kind: 'message', text: formatMessage(m, i + 1) });
    for (const att of m.attachments) {
      const first = seen.get(att.sha256);
      if (first) {
        blocks.push({
          kind: 'document',
          text: `### Documento: ${att.filename}\n(Mismo contenido que "${first}", ya incluido.)`,
        });
        continue;
      }
      seen.set(att.sha256, att.filename);
      const pages = [...(pagesBySha.get(att.sha256) ?? [])].sort(
        (a, b) => a.pageNumber - b.pageNumber,
      );
      if (pages.length === 0) {
        blocks.push({
          kind: 'document',
          text: `### Documento: ${att.filename}\n(Sin texto reconocido.)`,
        });
        continue;
      }
      for (const p of pages) {
        const r = renderPage(p, att.filename, next);
        doubtfulCount += r.doubtful;
        blocks.push({
          kind: 'document',
          text: `### Documento: ${att.filename} · página ${p.pageNumber}\n${r.text || '(página sin texto)'}`,
        });
      }
    }
  });
  return { blocks, doubtfulCount };
}

/** Estimación gruesa (~4 caracteres por token en español). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Agrupa bloques en tramos de hasta `maxTokens`; un bloque enorme se parte por líneas. */
export function chunkBlocks(blocks: string[], maxTokens: number): string[] {
  const maxChars = Math.max(400, maxTokens * 4);
  const pieces: string[] = [];
  for (const b of blocks) {
    if (b.length <= maxChars) {
      pieces.push(b);
      continue;
    }
    let cur = '';
    for (const line of b.split('\n')) {
      if (cur.length + line.length + 1 > maxChars && cur) {
        pieces.push(cur);
        cur = '';
      }
      // línea individual gigante: partir por caracteres
      for (let i = 0; i < line.length; i += maxChars) {
        const part = line.slice(i, i + maxChars);
        if (cur.length + part.length + 1 > maxChars && cur) {
          pieces.push(cur);
          cur = '';
        }
        cur += (cur ? '\n' : '') + part;
      }
    }
    if (cur) pieces.push(cur);
  }
  const chunks: string[] = [];
  let cur = '';
  for (const p of pieces) {
    if (cur && cur.length + p.length + 2 > maxChars) {
      chunks.push(cur);
      cur = '';
    }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}
