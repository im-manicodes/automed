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

  it('Ollama no alcanzable: pide revisar la URL, da ejemplos y ofrece la descarga', () => {
    render(<PanelOllama hardware={hardwareSinOllama()} onRecheck={() => {}} modelos={[M]} />)
    expect(screen.getByText(/No se pudo conectar con Ollama: revisa la URL/)).toBeInTheDocument()
    expect(screen.getByLabelText('URL de Ollama')).toBeInTheDocument()
    expect(screen.getByText('http://host.docker.internal:11434/v1')).toBeInTheDocument()
    expect(screen.getByText(/ip-del-servidor/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Descargar Ollama' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copiar/ })).toBeNull()
  })

  it('guarda la URL escrita y vuelve a consultar', async () => {
    const PUT = 'PUT /api/settings/ia'
    const f = mockFetch({ [PUT]: { body: {} } })
    const onRecheck = vi.fn()
    const user = userEvent.setup()
    render(<PanelOllama hardware={hardwareSinOllama()} onRecheck={onRecheck} modelos={[M]} />)
    await user.type(screen.getByLabelText('URL de Ollama'), 'http://10.0.0.5:11434/v1')
    await user.click(screen.getByRole('button', { name: /Guardar y probar/ }))
    await waitFor(() => expect(onRecheck).toHaveBeenCalledTimes(1))
    expect(callsOf(f).filter((c) => c === PUT)).toHaveLength(1)
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
