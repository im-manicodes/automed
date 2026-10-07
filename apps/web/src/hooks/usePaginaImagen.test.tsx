import { render, waitFor } from '@testing-library/react'
import { _vaciarCachePaginas, usePaginaImagen } from './usePaginaImagen'

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  _src = ''
  set src(v: string) {
    this._src = v
    queueMicrotask(() => this.onload?.())
  }
  get src() {
    return this._src
  }
}

function Visor({ pagina }: { pagina: number }) {
  const { img } = usePaginaImagen('adj', pagina)
  return <p data-testid="src">{img?.src ?? ''}</p>
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage)
})
afterEach(() => {
  _vaciarCachePaginas()
  vi.unstubAllGlobals()
})

describe('usePaginaImagen', () => {
  it('carga la imagen de la página desde la API', async () => {
    const r = render(<Visor pagina={1} />)
    await waitFor(() => expect(r.getByTestId('src').textContent).toBe('/api/attachments/adj/pages/1/image'))
    r.rerender(<Visor pagina={2} />)
    await waitFor(() => expect(r.getByTestId('src').textContent).toBe('/api/attachments/adj/pages/2/image'))
  })
})
