import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mockFetch } from '../../test/mockFetch';
import { limpiarCacheSugerencias } from './hooks/useSugerencias';
import { _vaciarCachePaginas } from '../../hooks/usePaginaImagen';
import RevisionPage from './page';

const respuesta = {
  attachmentId: 'a1',
  filename: 'informe.pdf',
  status: 'listo',
  pages: [
    {
      pageNumber: 1,
      width: 1000,
      height: 1400,
      imageUrl: '',
      regions: [{ id: 'r1', x: 0.2, y: 0.3, w: 0.2, h: 0.05, text: '12O', confidence: 0.4, status: 'dudoso', textoUsuario: null }],
    },
  ],
};

class ImagenFalsa {
  naturalWidth = 1000;
  naturalHeight = 1400;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  get src() {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    queueMicrotask(() => this.onload?.());
  }
}

function mediaMovil() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  limpiarCacheSugerencias();
  _vaciarCachePaginas();
  mediaMovil();
  vi.stubGlobal('Image', ImagenFalsa);
  mockFetch({
    'GET /api/attachments/a1/pages': { body: respuesta },
    'POST /api/ocr/regions/r1/suggest': { body: { sugerencias: [] } },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Revisión en celular', () => {
  it('tocar el recorte abre el modal a pantalla completa y el formulario queda solo dentro', async () => {
    render(
      <MemoryRouter initialEntries={['/tickets/t1/revision/a1']}>
        <Routes>
          <Route path="/tickets/:id/revision/:attachmentId" element={<RevisionPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Toca el recorte para verlo más grande.')).toBeInTheDocument();
    expect(screen.getAllByLabelText('¿Qué dice aquí?')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Ver más grande el recorte de la duda 1/ }));
    const d = await screen.findByRole('dialog');
    const campos = screen.getAllByLabelText('¿Qué dice aquí?');
    expect(campos).toHaveLength(1);
    expect(d).toContainElement(campos[0]);
    expect(campos[0]).not.toHaveFocus();
    expect(screen.getByText(/Pellizca para acercar/)).toBeInTheDocument();
    expect(within(d).getByText('Duda 1 de 1')).toBeInTheDocument();
  });
});
