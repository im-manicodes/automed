import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { hardwareIa, hardwareSinModelo, hardwareSinOllama } from '../../test/ajustesIa'
import { callsOf, mockFetch } from '../../test/mockFetch'
import PanelOllama from './PanelOllama'

const M = 'qwen3-vl:4b-instruct'
const POST = 'POST /api/settings/ia/ollama/pull'
const GB = 1024 ** 3

afterEach(() => vi.unstubAllGlobals())

describe('PanelOllama', () => {
  it('avisa que hay que actualizar Ollama si es anterior a la versión mínima de Qwen3-VL', () => {
    const f = mockFetch({})
    render(
      <PanelOllama
        hardware={hardwareIa({ ollama: { alcanzable: true, version: '0.11.4', modelos: [], versionMinima: '0.12.7', requiereActualizar: true } })}
        onRecheck={() => {}}
        modelos={[M]}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/anterior a la versión 0\.12\.7/)
    expect(f).not.toHaveBeenCalled()
  })

  it('sin aviso cuando la versión es suficiente', () => {
    render(<PanelOllama hardware={hardwareIa()} onRecheck={() => {}} modelos={[M]} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Ollama está listo/)
  })

  it('descarga sola, muestra progreso legible y avisa al terminar', async () => {
    mockFetch({
      [POST]: { status: 202, body: { modelo: M, estado: 'descargando' } },
      [`GET /api/settings/ia/ollama/pull?modelo=${encodeURIComponent(M)}`]: { body: { modelo: M, estado: 'descargando', completado: 1.2 * GB, total: 3.3 * GB } },
    })
    const onListoChange = vi.fn()
    render(<PanelOllama hardware={hardwareSinModelo()} onRecheck={() => {}} modelos={[M]} onListoChange={onListoChange} />)
    expect(await screen.findByText('Descargando…')).toBeInTheDocument()
    expect(await screen.findByText('1,2 de 3,3 GB · 36 %')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /Descarga de/ })).toHaveAttribute('aria-valuenow', '36')
    expect(screen.queryByRole('button', { name: /Descargar/ })).toBeNull()
    expect(onListoChange).toHaveBeenLastCalledWith(false)
  })

  it('si falla muestra el error y Reintentar vuelve a enviar el POST', async () => {
    let fallar = true
    const f = mockFetch({ [POST]: () => (fallar ? { status: 500, body: { message: 'sin conexión' } } : { status: 202, body: {} }) })
    render(<PanelOllama hardware={hardwareSinModelo()} onRecheck={() => {}} modelos={[M]} />)
    const reintentar = await screen.findByRole('button', { name: 'Reintentar' })
    expect(screen.getByRole('alert')).toHaveTextContent('sin conexión')
    fallar = false
    await userEvent.setup().click(reintentar)
    await waitFor(() => expect(callsOf(f).filter((c) => c === POST)).toHaveLength(2))
  })

  it('Ollama no alcanzable: avisa que se detectará solo', () => {
    render(<PanelOllama hardware={hardwareSinOllama()} onRecheck={() => {}} modelos={[M]} />)
    expect(screen.getByText(/No encontramos Ollama/)).toBeInTheDocument()
    expect(screen.getByText(/lo detectaremos solos/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Probar de nuevo' })).toBeInTheDocument()
  })

  it('en Docker sin conexión muestra la guía y Copiar escribe el comando', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<PanelOllama hardware={{ ...hardwareSinOllama(), entorno: 'docker' }} onRecheck={() => {}} modelos={[M]} />)
    expect(screen.getByText(/Ollama no acepta conexiones desde Docker/)).toBeInTheDocument()
    expect(screen.queryByText(/No encontramos Ollama/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Probar de nuevo' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Descargar Ollama' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Copiar/ }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('OLLAMA_HOST=0.0.0.0'))
    expect(await screen.findByRole('button', { name: /Copiado/ })).toBeInTheDocument()
  })

  it('en local la guía de Docker no aparece', () => {
    render(<PanelOllama hardware={{ ...hardwareSinOllama(), entorno: 'local' }} onRecheck={() => {}} modelos={[M]} />)
    expect(screen.getByText(/No encontramos Ollama/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copiar/ })).toBeNull()
  })

  it('guarda una sola vez la URL detectada y vuelve a consultar', async () => {
    const PUT = 'PUT /api/settings/ia'
    const f = mockFetch({ [PUT]: { body: {} } })
    const onRecheck = vi.fn()
    const hw = hardwareIa({ ollama: { alcanzable: true, modelos: [M], urlDetectada: 'http://172.17.0.1:11434/v1' } })
    const { rerender } = render(<PanelOllama hardware={hw} onRecheck={onRecheck} modelos={[M]} />)
    await waitFor(() => expect(onRecheck).toHaveBeenCalledTimes(1))
    rerender(<PanelOllama hardware={{ ...hw }} onRecheck={onRecheck} modelos={[M]} />)
    expect(callsOf(f).filter((c) => c === PUT)).toHaveLength(1)
    expect(onRecheck).toHaveBeenCalledTimes(1)
  })

  it('activo=false no hace nada', () => {
    const f = mockFetch({})
    render(<PanelOllama hardware={hardwareSinModelo()} onRecheck={() => {}} modelos={[M]} activo={false} />)
    expect(f).not.toHaveBeenCalled()
  })
})
