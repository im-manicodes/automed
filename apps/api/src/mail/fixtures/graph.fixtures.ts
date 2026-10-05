import { GraphMessage } from '../graph-mapper';

export const msg = (
  id: string,
  conv: string,
  extra: Partial<GraphMessage> = {},
): GraphMessage => ({
  id,
  conversationId: conv,
  subject: 'Resultados',
  from: { emailAddress: { name: 'Dra. Ana', address: 'ana@clinica.mx' } },
  toRecipients: [{ emailAddress: { name: 'Yo', address: 'yo@x.com' } }],
  ccRecipients: [],
  receivedDateTime: '2026-10-01T10:00:00Z',
  body: { contentType: 'text', content: `cuerpo ${id}` },
  hasAttachments: false,
  isDraft: false,
  ...extra,
});

export const pdfAtt = (id: string, name = 'estudio.pdf') => ({
  id,
  name,
  contentType: 'application/pdf',
  size: 10,
  '@odata.type': '#microsoft.graph.fileAttachment',
});
