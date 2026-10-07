import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import { callsOf, mockFetch } from '../../test/mockFetch'
import UsarCelular from './page'

function renderPage() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <UsarCelular />
      </ToastProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('usar desde el celular', () => {
  it('fuera del escritorio avisa que no está disponible', async () => {
    mockFetch({ 'GET /api/relay/status': { body: { disponible: false, configurado: false, activo: false, estado: 'desconectado' } } })
    renderPage()
    expect(await screen.findByText(/solo funciona en la aplicación de escritorio/)).toBeInTheDocument()
  })

  it('sin dirección del relay avisa', async () => {
    mockFetch({ 'GET /api/relay/status': { body: { disponible: true, configurado: false, activo: false, estado: 'desconectado' } } })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(/todavía no trae el servicio/)
  })

  it('activa y muestra QR, estado y la dirección', async () => {
    let activo = false
    const f = mockFetch({
      'GET /api/relay/status': () => ({
        body: activo
          ? { disponible: true, configurado: true, activo: true, estado: 'conectado', url: 'https://relay.test/d/abc' }
          : { disponible: true, configurado: true, activo: false, estado: 'desconectado' },
      }),
      'POST /api/relay/enable': () => {
        activo = true
        return { body: { disponible: true, configurado: true, activo: true, estado: 'conectando', url: 'https://relay.test/d/abc' } }
      },
    })
    const u = userEvent.setup()
    renderPage()
    await u.click(await screen.findByRole('button', { name: 'Activar' }))
    expect(await screen.findByText(/Conectado\. Ya puedes entrar/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Código QR/ })).toHaveAttribute('src', expect.stringContaining('data:image'))
    expect(screen.getByText('https://relay.test/d/abc')).toBeInTheDocument()
    expect(callsOf(f)).toContain('POST /api/relay/enable')
  })

  it('avisa si el servicio muestra un arranque distinto y ofrece la huella esperada', async () => {
    mockFetch({
      'GET /api/relay/status': {
        body: { disponible: true, configurado: true, activo: true, estado: 'conectado', url: 'https://relay.test/d/abc', arranque: { sha256: 'ab'.repeat(32), estado: 'distinto' } },
      },
    })
    renderPage()
    expect(await screen.findByText(/versión distinta de la pantalla de arranque/)).toBeInTheDocument()
    expect(screen.getByText('ab'.repeat(32))).toBeInTheDocument()
  })

  it('desvincula con confirmación', async () => {
    let activo = true
    const f = mockFetch({
      'GET /api/relay/status': () => ({
        body: activo
          ? { disponible: true, configurado: true, activo: true, estado: 'desconectado', url: 'https://relay.test/d/abc' }
          : { disponible: true, configurado: true, activo: false, estado: 'desconectado' },
      }),
      'POST /api/relay/disable': () => {
        activo = false
        return { body: { disponible: true, configurado: true, activo: false, estado: 'desconectado' } }
      },
    })
    const u = userEvent.setup()
    renderPage()
    expect(await screen.findByText(/Reintentando conectar/)).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Desvincular' }))
    expect(callsOf(f)).not.toContain('POST /api/relay/disable')
    await u.click(screen.getByRole('button', { name: 'Sí, desvincular' }))
    await waitFor(() => expect(callsOf(f)).toContain('POST /api/relay/disable'))
    expect(await screen.findByRole('button', { name: 'Activar' })).toBeInTheDocument()
  })
  it('mantener despierto: se ofrece apagado y se activa con POST', async () => {
    let despierto = false
    const f = mockFetch({
      'GET /api/relay/status': () => ({
        body: { disponible: true, configurado: true, activo: true, estado: 'conectado', url: 'https://relay.test/d/abc', mantenerDespierto: despierto },
      }),
      'POST /api/relay/keep-awake': ({ body }) => {
        despierto = (body as { activo: boolean }).activo
        return { body: { disponible: true, configurado: true, activo: true, estado: 'conectado', url: 'https://relay.test/d/abc', mantenerDespierto: despierto } }
      },
    })
    const u = userEvent.setup()
    renderPage()
    const sw = await screen.findByRole('switch', { name: /Mantener la computadora despierta/ })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await u.click(sw)
    await waitFor(() => expect(callsOf(f)).toContain('POST /api/relay/keep-awake'))
    await waitFor(() => expect(screen.getByRole('switch', { name: /despierta/ })).toHaveAttribute('aria-checked', 'true'))
  })
})
