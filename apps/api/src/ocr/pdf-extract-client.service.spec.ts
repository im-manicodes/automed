import { PdfExtractClientService } from './pdf-extract-client.service';

const make = (env: Record<string, string> = {}) =>
  new PdfExtractClientService({ get: (k: string) => env[k] } as any);

describe('PdfExtractClientService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('PDF_TEXT_MODE=off: no llama al servicio y devuelve null', async () => {
    const f = jest.fn();
    global.fetch = f as any;
    const svc = make({ PDF_TEXT_MODE: 'off' });
    expect(svc.enabled).toBe(false);
    expect(await svc.extract(new Uint8Array([1]))).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('envía el PDF a /extract con min_chars y devuelve las páginas', async () => {
    const pages = [
      {
        pageNumber: 1,
        kind: 'digital',
        markdown: '# a',
        width: 1,
        height: 1,
        chars: 90,
      },
    ];
    const f = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ pages }) });
    global.fetch = f as any;
    const svc = make({
      PDF_EXTRACT_URL: 'http://x:8001/',
      PDF_TEXT_MIN_CHARS: '80',
    });
    expect(await svc.extract(new Uint8Array([1]))).toEqual(pages);
    expect(f.mock.calls[0][0]).toBe('http://x:8001/extract?min_chars=80');
    expect(f.mock.calls[0][1].method).toBe('POST');
  });

  it('respuesta no ok o error de red -> null (sin lanzar)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500 }) as any;
    expect(await make().extract(new Uint8Array([1]))).toBeNull();
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as any;
    expect(await make().extract(new Uint8Array([1]))).toBeNull();
  });

  it('cuerpo sin pages -> null', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as any;
    expect(await make().extract(new Uint8Array([1]))).toBeNull();
  });
});
