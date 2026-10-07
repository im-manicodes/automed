import { PdfExtractClientService } from './pdf-extract-client.service';

const make = (env: Record<string, string> = {}) =>
  new PdfExtractClientService({ get: (k: string) => env[k] } as any);

describe('PdfExtractClientService', () => {
  it('PDF_TEXT_MODE=off: desactivado y devuelve null', async () => {
    const svc = make({ PDF_TEXT_MODE: 'off' });
    expect(svc.enabled).toBe(false);
    expect(await svc.extract(new Uint8Array([1]))).toBeNull();
  });

  it('por defecto está activo (modo node)', () => {
    expect(make().enabled).toBe(true);
    expect(make({ PDF_TEXT_MODE: 'auto' }).enabled).toBe(true);
  });
});
