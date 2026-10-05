/** Tipos mínimos de Microsoft Graph y funciones puras de mapeo (sin I/O). */

export interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  hasAttachments?: boolean;
  isDraft?: boolean;
  '@removed'?: { reason: string };
}

export interface GraphAttachment {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  '@odata.type'?: string;
}

export interface GraphPage<T> {
  value: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export function formatRecipient(r?: GraphRecipient): string {
  const a = r?.emailAddress;
  if (!a?.address) return a?.name ?? '';
  return a.name && a.name !== a.address
    ? `${a.name} <${a.address}>`
    : a.address;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function bodyToText(m: GraphMessage): string {
  const body = m.body?.content;
  if (!body) return m.bodyPreview ?? '';
  const text =
    m.body?.contentType?.toLowerCase() === 'html' ? stripHtml(body) : body;
  return text.replace(/\r\n/g, '\n').trim();
}

/** true si el remitente es la propia cuenta (comparación sin mayúsculas). */
export function isFromAccount(m: GraphMessage, accountEmail?: string | null) {
  const addr = m.from?.emailAddress?.address?.trim().toLowerCase();
  return !!addr && !!accountEmail && addr === accountEmail.trim().toLowerCase();
}

export function mapMessage(m: GraphMessage, accountEmail?: string | null) {
  return {
    graphId: m.id,
    conversationId: m.conversationId ?? m.id,
    subject: m.subject ?? '(sin asunto)',
    from: formatRecipient(m.from),
    to: (m.toRecipients ?? []).map(formatRecipient).filter(Boolean),
    cc: (m.ccRecipients ?? []).map(formatRecipient).filter(Boolean),
    bodyText: bodyToText(m),
    isFromMe: isFromAccount(m, accountEmail),
    // En Enviados Graph puede traer solo sentDateTime.
    receivedAt: new Date(m.receivedDateTime ?? m.sentDateTime ?? Date.now()),
    hasAttachments: !!m.hasAttachments,
  };
}

export function isPdfAttachment(a: GraphAttachment): boolean {
  const type = (a['@odata.type'] ?? '').toLowerCase();
  if (type && !type.endsWith('fileattachment')) return false;
  return (
    (a.contentType ?? '').toLowerCase() === 'application/pdf' ||
    (a.name ?? '').toLowerCase().endsWith('.pdf')
  );
}
