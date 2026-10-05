import {
  buildInputBlocks,
  chunkBlocks,
  cleanBody,
  InputMessage,
  InputPage,
} from './thread-input';

const msg = (over: Partial<InputMessage>): InputMessage => ({
  from: 'a@x.com',
  to: ['b@x.com'],
  cc: [],
  subject: 'S',
  bodyText: 'hola',
  isFromMe: false,
  receivedAt: new Date('2026-03-02T10:00:00Z'),
  attachments: [],
  ...over,
});

describe('cleanBody', () => {
  it('recorta citas y firmas', () => {
    const body =
      'Respuesta nueva\n\nEl lun, 2 mar 2026 a las 10:00, Ana escribió:\n> viejo\n> más viejo';
    expect(cleanBody(body)).toBe('Respuesta nueva');
    expect(cleanBody('Texto\n-- \nJuan Pérez\nTel 555')).toBe('Texto');
    expect(cleanBody('a\n> citado\nb')).toBe('a\nb');
    expect(cleanBody('Hola\n\nDe: Ana\nEnviado: lunes\nPara: yo')).toBe('Hola');
  });
});

describe('buildInputBlocks', () => {
  const pages = new Map<string, InputPage[]>([
    [
      'sha1',
      [
        {
          pageNumber: 2,
          text: null,
          regions: [
            { x: 0.1, y: 0.5, text: 'segunda', status: 'ok', userText: null },
            { x: 0.1, y: 0.1, text: 'prim?', status: 'dudoso', userText: null },
          ],
        },
        {
          pageNumber: 1,
          text: null,
          regions: [
            {
              x: 0.1,
              y: 0.2,
              text: 'mal',
              status: 'dudoso',
              userText: 'Total $500',
            },
            { x: 0.1, y: 0.1, text: 'Contrato', status: 'ok', userText: null },
            { x: 0.1, y: 0.3, text: 'xx', status: 'corregido', userText: null },
          ],
        },
      ],
    ],
  ]);

  it('ordena mensajes, indica isFromMe, usa texto_usuario y marca ilegibles', () => {
    const { blocks, doubtfulCount } = buildInputBlocks(
      [
        msg({
          bodyText: 'segundo',
          isFromMe: true,
          receivedAt: new Date('2026-03-03T10:00:00Z'),
        }),
        msg({
          bodyText: 'primero',
          attachments: [{ sha256: 'sha1', filename: 'contrato.pdf' }],
        }),
      ],
      pages,
    );
    const all = blocks.map((b) => b.text).join('\n');
    expect(all.indexOf('primero')).toBeLessThan(all.indexOf('segundo'));
    expect(blocks[0].text).toContain('RECIBIDO');
    expect(blocks.find((b) => b.text.includes('segundo'))!.text).toContain(
      'ENVIADO POR MÍ',
    );
    expect(all).toContain('Total $500');
    expect(all).not.toContain('mal');
    expect(all).toContain('[ilegible #1 · contrato.pdf · p.2]');
    expect(doubtfulCount).toBe(1);
    // páginas en orden (p.1 antes que p.2) y líneas por y
    expect(all.indexOf('página 1')).toBeLessThan(all.indexOf('página 2'));
    expect(all.indexOf('Contrato')).toBeLessThan(all.indexOf('Total $500'));
  });

  it('adjunto repetido no duplica el texto', () => {
    const { blocks } = buildInputBlocks(
      [
        msg({
          attachments: [
            { sha256: 'sha1', filename: 'a.pdf' },
            { sha256: 'sha1', filename: 'b.pdf' },
          ],
        }),
      ],
      pages,
    );
    expect(blocks.map((b) => b.text).join('\n')).toContain(
      'Mismo contenido que "a.pdf"',
    );
  });
});

describe('chunkBlocks', () => {
  it('respeta el máximo y parte bloques enormes', () => {
    const chunks = chunkBlocks(
      ['a'.repeat(1000), 'b'.repeat(1000), 'línea\n'.repeat(2000)],
      500,
    );
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2000);
  });
});
