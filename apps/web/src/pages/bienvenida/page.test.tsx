import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import { ajustesIa, hardwareIa, hardwareSinModelo, hardwareSinOllama } from '../../test/ajustesIa'
import { ajustesAlmacenamiento } from '../../test/ajustesAlmacenamiento'
import { ajustesOcr } from '../../test/ajustesOcr'
import { callsOf, mockFetch, type MockHandler } from '../../test/mockFetch'
import Bienvenida from './page'

function Ubicacion() {
  const l = useLocation()
  return <output data-testid="ubicacion">{l.pathname}</output>
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/bienvenida']}>
      <ToastProvider>
        <Routes>
          <Route path="/bienvenida" element={<Bienvenida />} />
          <Route path="*" element={<p>Otra pantalla</p>} />
        </Routes>
        <Ubicacion />
      </ToastProvider>
    </MemoryRouter>,
  )
}

const puts = (f: ReturnType<typeof mockFetch>) =>
  f.mock.calls.filter(([, i]) => (i?.method ?? 'GET') === 'PUT').map(([, i]) => JSON.parse(String(i?.body)))

function rutas(hw: MockHandler = { body: hardwareIa() }, ocr: MockHandler = { body: ajustesOcr() }) {
  return {
    'GET /api/settings/storage': { body: ajustesAlmacenamiento() },
    'GET /api/settings/ocr': ocr,
    'PUT /api/settings/ocr': (req: { body: unknown }) => ({ body: ajustesOcr({ motor: (req.body as { motor: 'local' | 'textract' | 'ninguno' }).motor }) }),
    'GET /api/settings/ia': { body: ajustesIa() },
    'GET /api/settings/ia/hardware': hw,
    'PUT /api/settings/ia': { body: ajustesIa({ necesitaBienvenida: false, proveedor: 'openai', claves: { openai: true, anthropic: false, aws: false, foundry: false } }) },
    'POST /api/settings/ia/test': { body: { ok: true, ms: 321, mensaje: 'ok' } },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Asistente de bienvenida', () => {
  it('flujo completo con OpenAI: guarda la config con la clave y no la muestra después', async () => {
    const f = mockFetch(rutas())
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Siguiente/ }))
    await user.click(await screen.findByRole('radio', { name: /OpenAI/ }))
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))

    await user.type(screen.getByLabelText('Clave de OpenAI'), 'sk-secreta-123')
    await user.click(screen.getByRole('button', { name: 'Probar' }))
    expect(await screen.findByText('Funciona (321 ms)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))

    // Modelos preseleccionados con los sugeridos de OpenAI.
    expect(screen.getByLabelText('Resúmenes de tickets')).toHaveValue('gpt-4o-mini')
    expect(screen.getByLabelText('Lectura de zonas dudosas (visión)')).toHaveValue('gpt-4o')
    expect(screen.getByLabelText('Segundo intento de zonas dudosas (visión)')).toHaveValue('gpt-4o')
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))

    // Paso de lectura de PDFs escaneados: se deja para después.
    expect(await screen.findByText('¿Cómo leemos tus PDFs escaneados?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))

    // Paso de almacenamiento: ya configurado, se puede continuar.
    expect(await screen.findByText('¿Dónde guardamos tus archivos?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))

    expect(screen.getByText('Todo listo')).toBeInTheDocument()
    expect(screen.queryByText('sk-secreta-123')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Conectar Outlook' }))

    await waitFor(() => expect(screen.getByTestId('ubicacion')).toHaveTextContent('/ajustes'))
    const [body] = puts(f)
    expect(body).toMatchObject({ proveedor: 'openai', claveOpenai: 'sk-secreta-123', bienvenidaCompletada: true })
    expect(body.modelos.resumen).toBe('gpt-4o-mini')
    expect(body.modelos.vision_respaldo).toBe('gpt-4o')
    expect(body.modelos.vision_sugerencias).toBe('gpt-4o')
    expect(body).toMatchObject({ segundoIntento: true, sugerencias: true })
    expect(document.body.innerHTML).not.toContain('sk-secreta-123')
  })

  it('con Foundry exige endpoint y clave, y los envía al guardar', async () => {
    const f = mockFetch(rutas())
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Siguiente/ }))
    await user.click(await screen.findByRole('radio', { name: /Microsoft Foundry/ }))
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))

    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeDisabled()
    await user.type(screen.getByLabelText('Endpoint de Foundry'), 'https://mi.openai.azure.com/openai/v1')
    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeDisabled()
    await user.type(screen.getByLabelText('Clave de Foundry'), 'fk-secreta-123')
    await user.click(screen.getByRole('button', { name: 'Probar' }))
    await screen.findByText('Funciona (321 ms)')
    const prueba = f.mock.calls.find(([u]) => String(u).endsWith('/settings/ia/test'))
    expect(JSON.parse(String(prueba?.[1]?.body))).toMatchObject({ proveedor: 'foundry', claveFoundry: 'fk-secreta-123', foundryEndpoint: 'https://mi.openai.azure.com/openai/v1' })
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))
    await screen.findByText('¿Cómo leemos tus PDFs escaneados?')
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))
    await screen.findByText('¿Dónde guardamos tus archivos?')
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))
    await user.click(screen.getByRole('button', { name: 'Conectar Outlook' }))
    await waitFor(() => expect(puts(f).length).toBeGreaterThan(0))
    expect(puts(f)[0]).toMatchObject({ proveedor: 'foundry', claveFoundry: 'fk-secreta-123', foundryEndpoint: 'https://mi.openai.azure.com/openai/v1' })
  })

  it('deshabilita Ollama y muestra el motivo si la RAM no alcanza', async () => {
    mockFetch(rutas({ body: hardwareIa({ ramGb: 4, ollamaApto: { apto: false, velocidad: null, motivo: 'Este equipo tiene 4 GB de memoria; se necesitan al menos 8 GB.' } }) }))
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Siguiente/ }))
    const ollama = await screen.findByRole('radio', { name: /Ollama/ })
    await waitFor(() => expect(ollama).toBeDisabled())
    expect(screen.getByText(/se necesitan al menos 8 GB/)).toBeInTheDocument()
  })

  it('"Omitir por ahora" solo marca la bienvenida como completada', async () => {
    const f = mockFetch(rutas())
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Omitir por ahora' }))
    await waitFor(() => expect(screen.getByText('Otra pantalla')).toBeInTheDocument())
    expect(puts(f)).toEqual([{ bienvenidaCompletada: true }])
  })

  it('"Usar la configuración del servidor" termina sin cambiar la config', async () => {
    const f = mockFetch(rutas())
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Siguiente/ }))
    await user.click(screen.getByRole('radio', { name: /configuración actual del servidor/ }))
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))
    await screen.findByText('¿Cómo leemos tus PDFs escaneados?')
    await user.click(await screen.findByRole('button', { name: /Siguiente/ }))
    await screen.findByText('¿Dónde guardamos tus archivos?')
    await user.click(await screen.findByRole('button', { name: /Siguiente/ }))
    await user.click(await screen.findByRole('button', { name: 'Ir a mis tickets' }))
    await waitFor(() => expect(screen.getByTestId('ubicacion')).toHaveTextContent('/tickets'))
    expect(puts(f)).toEqual([{ bienvenidaCompletada: true }])
  })

  describe('con Ollama', () => {
    const M = 'qwen3-vl:4b-instruct'
    const POST = 'POST /api/settings/ia/ollama/pull'
    const GET_PULL = `GET /api/settings/ia/ollama/pull?modelo=${encodeURIComponent(M)}`

    async function aPasoOllama() {
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: /Siguiente/ }))
      await user.click(await screen.findByRole('radio', { name: /Ollama/ }))
      await user.click(screen.getByRole('button', { name: /Siguiente/ }))
      return user
    }

    it('descarga sola y habilita Siguiente al terminar; Atrás y Omitir siguen activos', async () => {
      let hw = hardwareSinModelo()
      let pull: 'descargando' | 'listo' = 'descargando'
      const f = mockFetch({
        ...rutas(),
        'GET /api/settings/ia/hardware': () => ({ body: hw }),
        [POST]: { status: 202, body: { modelo: M, estado: 'descargando' } },
        [GET_PULL]: () => ({ body: { modelo: M, estado: pull, completado: 1, total: 2 } }),
      })
      renderPage()
      const user = await aPasoOllama()
      await waitFor(() => expect(callsOf(f)).toContain(POST))
      const siguiente = screen.getByRole('button', { name: /Siguiente/ })
      expect(siguiente).toBeDisabled()
      expect(await screen.findByText('Estamos descargando el modelo. Podrás continuar cuando termine.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Atrás/ })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Omitir por ahora' })).toBeEnabled()
      hw = hardwareSinModelo([M])
      pull = 'listo'
      await waitFor(() => expect(siguiente).toBeEnabled(), { timeout: 4000 })
      expect(callsOf(f).filter((c) => c === POST)).toHaveLength(1)
      await user.click(siguiente)
      expect(await screen.findByText('Qué modelo usar en cada tarea')).toBeInTheDocument()
    })

    it('con el modelo ya instalado no descarga y Siguiente queda habilitado', async () => {
      const f = mockFetch(rutas())
      renderPage()
      await aPasoOllama()
      await waitFor(() => expect(screen.getByRole('button', { name: /Siguiente/ })).toBeEnabled())
      expect(callsOf(f)).not.toContain(POST)
    })

    it('con Ollama desactualizado no descarga, avisa y bloquea', async () => {
      const f = mockFetch(rutas({ body: hardwareIa({ ollama: { alcanzable: true, version: '0.11.4', modelos: [], versionMinima: '0.12.7', requiereActualizar: true } }) }))
      renderPage()
      await aPasoOllama()
      expect(await screen.findByText(/anterior a la versión 0\.12\.7/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Siguiente/ })).toBeDisabled()
      expect(callsOf(f)).not.toContain(POST)
    })

    it('sin Ollama pide instalarlo y bloquea', async () => {
      mockFetch(rutas({ body: hardwareSinOllama() }))
      renderPage()
      await aPasoOllama()
      expect(await screen.findByText('Instala Ollama para continuar.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Siguiente/ })).toBeDisabled()
    })

    it('con otro proveedor no se bloquea ni se descarga nada', async () => {
      const f = mockFetch(rutas({ body: hardwareSinModelo() }))
      renderPage()
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: /Siguiente/ }))
      await user.click(await screen.findByRole('radio', { name: /Bedrock/ }))
      await user.click(screen.getByRole('button', { name: /Siguiente/ }))
      expect(screen.getByRole('button', { name: /Siguiente/ })).toBeEnabled()
      expect(callsOf(f).filter((c) => c.startsWith('POST') && c.includes('pull'))).toHaveLength(0)
    })
  })
})
