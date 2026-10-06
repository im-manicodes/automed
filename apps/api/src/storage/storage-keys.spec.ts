import {
  isFolderKey,
  nextPdfIndex,
  ownPageKey,
  pageKey,
  pdfFolder,
  pdfKey,
} from './storage-keys';

describe('storage-keys', () => {
  it('construye carpeta, PDF y páginas', () => {
    expect(pdfFolder('t1', 2)).toBe('hilos/t1/pdf_2');
    expect(pdfKey('t1', 1)).toBe('hilos/t1/pdf_1/original.pdf');
    expect(pdfKey('t1', 1, 'demo/')).toBe('demo/hilos/t1/pdf_1/original.pdf');
    expect(pageKey('hilos/t1/pdf_1/original.pdf', 3)).toBe(
      'hilos/t1/pdf_1/pagina_3.png',
    );
  });
  it('nextPdfIndex usa el máximo (con huecos) e ignora claves antiguas', () => {
    expect(nextPdfIndex([])).toBe(1);
    expect(nextPdfIndex(['attachments/abc.pdf'])).toBe(1);
    expect(
      nextPdfIndex([
        'hilos/t/pdf_1/original.pdf',
        'hilos/t/pdf_4/original.pdf',
      ]),
    ).toBe(5);
  });
  it('ownPageKey solo para el layout nuevo', () => {
    expect(isFolderKey('attachments/abc.pdf')).toBe(false);
    expect(ownPageKey('attachments/abc.pdf', 1)).toBeNull();
    expect(ownPageKey('demo/hilos/t/pdf_2/original.pdf', 1)).toBe(
      'demo/hilos/t/pdf_2/pagina_1.png',
    );
  });
});
