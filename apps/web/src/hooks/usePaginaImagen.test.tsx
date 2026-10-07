import { act, render, waitFor } from '@testing-library/react'
import { _vaciarCachePaginas, usePaginaImagen } from './usePaginaImagen'

vi.mock('../lib/e2e', () => ({ usaE2e: () => true }))
vi.mock('../lib/api', () => ({ apiBlob: vi.fn(async () => new Blob(['x'])) }))

const creados: HTMLImageElement[] = []
let n = 0
const crear = vi.fn(() => `blob:p${++n}`)
const liberar = vi.fn()

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  _src = ''
  constructor() {
    creados.push(this as unknown as HTMLImageElement)
  }
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
  n = 0
  creados.length = 0
  crear.mockClear()
  liberar.mockClear()
  vi.stubGlobal('Image', FakeImage)
  URL.createObjectURL = crear
  URL.revokeObjectURL = liberar
})
afterEach(() => {
  _vaciarCachePaginas()
  vi.unstubAllGlobals()
})

describe('usePaginaImagen (E2E)', () => {
  it('libera el blob al cambiar de página y al desmontar', async () => {
    const r = render(<Visor pagina={1} />)
    await waitFor(() => expect(r.getByTestId('src').textContent).toBe('blob:p1'))
    expect(liberar).not.toHaveBeenCalled()
    r.rerender(<Visor pagina={2} />)
    await waitFor(() => expect(r.getByTestId('src').textContent).toBe('blob:p2'))
    expect(liberar).toHaveBeenCalledWith('blob:p1')
    r.unmount()
    expect(liberar).toHaveBeenCalledWith('blob:p2')
  })

  it('dos usos de la misma página comparten el blob y se libera al soltar el último', async () => {
    const r = render(
      <>
        <Visor pagina={1} />
        <Visor pagina={1} />
      </>,
    )
    await waitFor(() => expect(r.getAllByTestId('src').every((e) => e.textContent !== '')).toBe(true))
    // Cada carga pidió su blob; el sobrante se liberó y quedó uno solo en uso.
    const vivos = crear.mock.calls.length - liberar.mock.calls.length
    expect(vivos).toBe(1)
    const antes = liberar.mock.calls.length
    r.unmount()
    await act(async () => {})
    expect(liberar.mock.calls.length).toBe(antes + 1)
  })

  it('si se desmonta antes de cargar, libera el blob', async () => {
    const r = render(<Visor pagina={3} />)
    r.unmount()
    await act(async () => {
      await new Promise((res) => setTimeout(res, 5))
    })
    expect(crear.mock.calls.length).toBe(liberar.mock.calls.length)
  })
})
