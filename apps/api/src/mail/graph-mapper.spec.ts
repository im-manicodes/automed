import { bodyToText, isPdfAttachment, mapMessage } from './graph-mapper';
import { msg, pdfAtt } from './fixtures/graph.fixtures';

describe('graph-mapper', () => {
  it('mapea remitentes, fechas y cuerpo', () => {
    const m = mapMessage(
      msg('1', 'c1', {
        ccRecipients: [{ emailAddress: { address: 'cc@x.com' } }],
      }),
    );
    expect(m.from).toBe('Dra. Ana <ana@clinica.mx>');
    expect(m.to).toEqual(['Yo <yo@x.com>']);
    expect(m.cc).toEqual(['cc@x.com']);
    expect(m.receivedAt.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(m.bodyText).toBe('cuerpo 1');
  });

  it('convierte HTML a texto', () => {
    const t = bodyToText(
      msg('1', 'c', {
        body: {
          contentType: 'html',
          content:
            '<p>Hola&nbsp;<b>mundo</b></p><style>x{}</style><p>Adiós</p>',
        },
      }),
    );
    expect(t).toBe('Hola mundo\nAdiós');
  });

  it('detecta PDFs y excluye otros tipos', () => {
    expect(isPdfAttachment(pdfAtt('a'))).toBe(true);
    expect(isPdfAttachment({ id: 'b', name: 'x.PDF' })).toBe(true);
    expect(
      isPdfAttachment({ id: 'c', name: 'foto.png', contentType: 'image/png' }),
    ).toBe(false);
    expect(
      isPdfAttachment({
        ...pdfAtt('d'),
        '@odata.type': '#microsoft.graph.itemAttachment',
      }),
    ).toBe(false);
  });
});
