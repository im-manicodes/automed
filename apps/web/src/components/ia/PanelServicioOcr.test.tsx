import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OcrLocal } from '../../lib/api'
import { ajustesOcr } from '../../test/ajustesOcr'
import { callsOf, mockFetch } from '../../test/mockFetch'
import PanelServicioOcr from './PanelServicioOcr'

const servidor = { servidor: true }

const local = (o: Partial<OcrLocal> = {}): OcrLocal => ({
  gestionado: true,
  estado: 'no-instalado',
  paso: 'Sin instalar',
  progreso: 0,
  error: null,
  desactualizado: false,
  proceso: 'detenido',
  lineas: [],
  requisitos: { espacioGb: 4, internet: true },
  ...o,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PanelServicioOcr', () => {
  it('listo: aviso verde sin respaldo, con Detener y Reinstalar', async () => {
    mockFetch({ 'GET /api/settings/ocr/local': { body: local({ estado: 'listo', proceso: 'en-marcha' }) } })
    render(<PanelServicioOcr ajustes={ajustesOcr({ entorno: servidor, servicioLocal: { estado: 'listo' } })} onRecheck={() => {}} />)
    expect(screen.getByText(/El servicio de OCR está funcionando/)).toBeInTheDocument()
    expect(screen.queryByText(/Tesseract/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Probar el OCR/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Detener/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reinstalar/ })).toBeInTheDocument()
    expect(screen.queryByText(/docker compose/)).not.toBeInTheDocument()
  })

  it('listo con respaldo: avisa de Tesseract', () => {
    mockFetch({ 'GET /api/settings/ocr/local': { body: local({ estado: 'listo' }) } })
    render(<PanelServicioOcr ajustes={ajustesOcr({ entorno: servidor, servicioLocal: { estado: 'listo', fallbackReason: 'paddle no cargó' } })} onRecheck={() => {}} />)
    expect(screen.getByText(/Tesseract como respaldo, menos preciso con manuscrito/)).toBeInTheDocument()
  })

  it('sin instalar: avisa de espacio e internet y ofrece «Instalar OCR local»', async () => {
    let estado: OcrLocal = local()
    const fetchMock = mockFetch({
      'GET /api/settings/ocr/local': () => ({ body: estado }),
      'POST /api/settings/ocr/local/instalar': () => {
        estado = local({ estado: 'instalando', paso: 'Descargando Python', progreso: 7, lineas: [{ id: 1, ts: 't', nivel: 'log', mensaje: 'Collecting fastapi' }] })
        return { status: 202, body: estado }
      },
    })
    const onRecheck = vi.fn()
    render(<PanelServicioOcr ajustes={ajustesOcr({ entorno: servidor, servicioLocal: { estado: 'detenido', mensaje: 'No instalado.' } })} onRecheck={onRecheck} />)
    expect(await screen.findByText(/4 GB libres/)).toBeInTheDocument()
    expect(screen.getByText(/necesita internet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Instalar OCR local' }))
    const barra = await screen.findByRole('progressbar', { name: 'Progreso de la instalación' })
    expect(barra).toHaveAttribute('aria-valuenow', '7')
    expect(screen.getByText('Descargando Python')).toBeInTheDocument()
    expect(screen.getByText(/Collecting fastapi/)).toBeInTheDocument()
    expect(screen.getByText(/Puedes seguir usando la app/)).toBeInTheDocument()
    expect(callsOf(fetchMock)).toContain('POST /api/settings/ocr/local/instalar')
    expect(onRecheck).toHaveBeenCalled()
  })

  it('instalando: consulta el avance cada 2 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let n = 0
      mockFetch({
        'GET /api/settings/ocr/local': () => {
          n++
          return { body: local({ estado: 'instalando', paso: 'Instalando dependencias', progreso: 30 + n }) }
        },
      })
      render(<PanelServicioOcr ajustes={ajustesOcr({ entorno: servidor, servicioLocal: { estado: 'iniciando' } })} onRecheck={() => {}} />)
      await screen.findByRole('progressbar')
      await vi.advanceTimersByTimeAsync(2100)
      await waitFor(() => expect(n).toBeGreaterThanOrEqual(2))
    } finally {
      vi.useRealTimers()
    }
  })

  it('error de instalación: muestra el motivo y permite reintentar', async () => {
    const fetchMock = mockFetch({
      'GET /api/settings/ocr/local': { body: local({ estado: 'error', error: 'No hay espacio suficiente.' }) },
      'POST /api/settings/ocr/local/instalar': { status: 409, body: { message: 'Ya hay una instalación en marcha.' } },
    })
    render(<PanelServicioOcr ajustes={ajustesOcr({ entorno: servidor, servicioLocal: { estado: 'error', mensaje: 'x' } })} onRecheck={() => {}} />)
    expect(await screen.findByText(/No hay espacio suficiente/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Intentar de nuevo' }))
    expect(await screen.findByText(/Ya hay una instalación en marcha/)).toBeInTheDocument()
    expect(callsOf(fetchMock)).toContain('POST /api/settings/ocr/local/instalar')
  })

  it('instalado pero detenido: Iniciar llama a la API', async () => {
    const fetchMock = mockFetch({
      'GET /api/settings/ocr/local': { body: local({ estado: 'listo', proceso: 'detenido' }) },
      'POST /api/settings/ocr/local/iniciar': { body: local({ estado: 'listo', proceso: 'iniciando' }) },
    })
    const onRecheck = vi.fn()
    render(<PanelServicioOcr ajustes={ajustesOcr({ entorno: servidor, servicioLocal: { estado: 'detenido', mensaje: 'El OCR local está detenido.' } })} onRecheck={onRecheck} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar' }))
    expect(callsOf(fetchMock)).toContain('POST /api/settings/ocr/local/iniciar')
    expect(onRecheck).toHaveBeenCalled()
  })

  it('desinstalar pide confirmación', async () => {
    const fetchMock = mockFetch({
      'GET /api/settings/ocr/local': { body: local({ estado: 'listo', proceso: 'en-marcha' }) },
      'DELETE /api/settings/ocr/local': { body: local() },
    })
    render(<PanelServicioOcr ajustes={ajustesOcr({ entorno: servidor, servicioLocal: { estado: 'listo' } })} onRecheck={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: /^Desinstalar/ }))
    expect(callsOf(fetchMock)).not.toContain('DELETE /api/settings/ocr/local')
    await userEvent.click(screen.getByRole('button', { name: 'Sí, desinstalar' }))
    await waitFor(() => expect(callsOf(fetchMock)).toContain('DELETE /api/settings/ocr/local'))
  })

  it('servicio externo detenido: Probar de nuevo, sin botones de instalar', async () => {
    let fin: () => void = () => {}
    mockFetch({ 'GET /api/settings/ocr/local': { body: local({ gestionado: false }) } })
    const onRecheck = vi.fn(() => new Promise<void>((r) => { fin = r }))
    render(<PanelServicioOcr ajustes={ajustesOcr({ entorno: servidor, servicioLocal: { estado: 'detenido', mensaje: 'No responde ocr-local.' } })} onRecheck={onRecheck} />)
    expect(screen.getByText(/No responde ocr-local/)).toBeInTheDocument()
    expect(await screen.findByText(/servicio de OCR aparte/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Instalar OCR local/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reinstalar/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Probar de nuevo' }))
    expect(onRecheck).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: /Buscando/ })).toBeDisabled()
    fin()
    expect(await screen.findByRole('button', { name: 'Probar de nuevo' })).toBeEnabled()
  })
})
