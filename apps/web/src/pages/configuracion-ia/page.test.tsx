import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import { ajustesIa, hardwareIa } from '../../test/ajustesIa'
import { ajustesOcr } from '../../test/ajustesOcr'
import { mockFetch } from '../../test/mockFetch'
import ConfiguracionIa from './page'

afterEach(() => vi.unstubAllGlobals())

describe('Configuración de IA', () => {
  it('carga, edita un modelo, guarda y prueba', async () => {
    const actual = ajustesIa({ necesitaBienvenida: false, proveedor: 'openai', claves: { openai: true, anthropic: false, aws: false, foundry: false } })
    const f = mockFetch({
      'GET /api/settings/ia': { body: actual },
      'GET /api/settings/ia/hardware': { body: hardwareIa() },
      'PUT /api/settings/ia': (req) => ({ body: { ...actual, modelos: { ...actual.modelos, ...(req.body as { modelos: object }).modelos } } }),
      'POST /api/settings/ia/test': { body: { ok: false, ms: 0, mensaje: 'La clave no es válida' } },
    })
    render(
      <MemoryRouter>
        <ToastProvider>
          <ConfiguracionIa />
        </ToastProvider>
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    expect(await screen.findByText('Ya hay una clave guardada')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Reporte de Excel'), 'gpt-4o')
    await user.click(screen.getByRole('button', { name: 'Probar' }))
    expect(await screen.findByText('La clave no es válida')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(screen.getByText('Cambios guardados.')).toBeInTheDocument())
    const put = f.mock.calls.find(([, i]) => i?.method === 'PUT')
    const body = JSON.parse(String(put?.[1]?.body))
    expect(body.modelos.reporte).toBe('gpt-4o')
    expect(body.modelos).toHaveProperty('vision_respaldo')
    expect(body.modelos).toHaveProperty('vision_sugerencias')
    expect(body).toMatchObject({ segundoIntento: true, sugerencias: true })
    expect(body.proveedor).toBe('openai')
    expect(body).not.toHaveProperty('claveOpenai')
    expect(body).not.toHaveProperty('bienvenidaCompletada')
  })
})

describe('Configuración de IA: Foundry', () => {
  it('muestra endpoint y clave, y guarda ambos', async () => {
    const actual = ajustesIa({ necesitaBienvenida: false, proveedor: 'foundry', foundryEndpoint: 'https://a.openai.azure.com/openai/v1', claves: { openai: false, anthropic: false, aws: false, foundry: true } })
    const f = mockFetch({
      'GET /api/settings/ia': { body: actual },
      'GET /api/settings/ia/hardware': { body: hardwareIa() },
      'PUT /api/settings/ia': { body: actual },
    })
    render(
      <MemoryRouter>
        <ToastProvider>
          <ConfiguracionIa />
        </ToastProvider>
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    expect(await screen.findByText('Ya hay una clave guardada')).toBeInTheDocument()
    const ep = screen.getByLabelText('Endpoint de Foundry')
    expect(ep).toHaveValue('https://a.openai.azure.com/openai/v1')
    await user.clear(ep)
    await user.type(ep, 'https://b.openai.azure.com/openai/v1')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(screen.getByText('Cambios guardados.')).toBeInTheDocument())
    const put = f.mock.calls.find(([, i]) => i?.method === 'PUT')
    const body = JSON.parse(String(put?.[1]?.body))
    expect(body).toMatchObject({ proveedor: 'foundry', foundryEndpoint: 'https://b.openai.azure.com/openai/v1' })
    expect(body).not.toHaveProperty('claveFoundry')
  })
})

describe('Configuración de IA: lectura de PDFs escaneados', () => {
  const base = () => ajustesIa({ necesitaBienvenida: false })
  const montar = (ocr: Record<string, unknown>) => {
    let motor: 'local' | 'textract' | 'ninguno' = 'ninguno'
    const f = mockFetch({
      'GET /api/settings/ia': { body: base() },
      'GET /api/settings/ia/hardware': { body: hardwareIa() },
      'GET /api/settings/ocr': () => ({ body: ajustesOcr({ motor }) }),
      'PUT /api/settings/ia': { body: ajustesIa({ necesitaBienvenida: false, claves: { openai: false, anthropic: false, aws: true, foundry: false } }) },
      'PUT /api/settings/ocr': (req) => {
        motor = (req.body as { motor: typeof motor }).motor
        return { body: ajustesOcr({ motor }) }
      },
      'POST /api/settings/ocr/probar': { body: { ok: false, ms: 0, mensaje: 'AWS rechazó las claves.' } },
      ...ocr,
    })
    render(
      <MemoryRouter>
        <ToastProvider>
          <ConfiguracionIa />
        </ToastProvider>
      </MemoryRouter>,
    )
    return f
  }

  it('muestra la tarjeta, elige Textract, guarda las claves y nunca las deja visibles', async () => {
    const f = montar({})
    const user = userEvent.setup()
    expect(await screen.findByText('Lectura de PDFs escaneados', { selector: 'h3' })).toBeInTheDocument()
    await user.click(await screen.findByRole('radio', { name: /Amazon Textract/ }))
    const guardar = screen.getByRole('button', { name: 'Guardar lectura de PDFs' })
    expect(guardar).toBeDisabled()
    await user.type(screen.getByLabelText('ID de clave de acceso de AWS'), 'AKIACONFIG999')
    await user.type(screen.getByLabelText('Clave secreta de AWS'), 'secreto-config-777')
    await user.click(guardar)
    await waitFor(() => expect(screen.getByText('Cambios guardados.')).toBeInTheDocument())

    const puts = (u: string) => f.mock.calls.filter(([x, i]) => String(x) === u && i?.method === 'PUT').map(([, i]) => JSON.parse(String(i?.body)))
    expect(puts('/api/settings/ia')).toEqual([{ claveAwsAccessKeyId: 'AKIACONFIG999', claveAwsSecreto: 'secreto-config-777' }])
    expect(puts('/api/settings/ocr')).toEqual([{ motor: 'textract', visionRetry: true, visionMaxRegions: 40, renderDpi: 200, textractMode: 'detect' }])
    expect(await screen.findByText('Ya hay una clave guardada')).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('AKIACONFIG999')
    expect(document.body.innerHTML).not.toContain('secreto-config-777')
  })

  it('permite cambiar la longitud máxima del resumen y la calidad de lectura', async () => {
    const f = montar({})
    const user = userEvent.setup()
    await user.click(await screen.findByText('Opciones avanzadas'))
    const campo = await screen.findByLabelText('Longitud máxima de cada resumen')
    expect(campo).toHaveValue(8000)
    expect(screen.getByText(/Súbela si un resumen sale cortado/)).toBeInTheDocument()
    await user.clear(campo)
    await user.type(campo, '12000')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(screen.getByText('Cambios guardados.')).toBeInTheDocument())
    const puts = f.mock.calls.filter(([x, i]) => String(x) === '/api/settings/ia' && i?.method === 'PUT').map(([, i]) => JSON.parse(String(i?.body)))
    expect(puts[0].maxOutputTokens).toBe(12000)
  })

  it('Probar Textract muestra el error de AWS', async () => {
    montar({ 'GET /api/settings/ia': { body: ajustesIa({ necesitaBienvenida: false, claves: { openai: false, anthropic: false, aws: true, foundry: false } }) } })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: /Amazon Textract/ }))
    await user.click(screen.getByRole('button', { name: 'Probar Textract' }))
    expect(await screen.findByText('AWS rechazó las claves.')).toBeInTheDocument()
  })

  it('con Amazon Bedrock se piden las claves de AWS en la conexión y se guardan con la IA', async () => {
    const f = montar({ 'GET /api/settings/ia': { body: ajustesIa({ necesitaBienvenida: false, proveedor: 'bedrock' }) } })
    const user = userEvent.setup()
    await screen.findByText('Lectura de PDFs escaneados', { selector: 'h3' })
    const ids = await screen.findAllByLabelText('ID de clave de acceso de AWS')
    expect(ids).toHaveLength(1)
    await user.type(ids[0], 'AKIABEDROCK1')
    await user.type(screen.getByLabelText('Clave secreta de AWS'), 'secreto-bedrock-2')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(screen.getByText('Cambios guardados.')).toBeInTheDocument())
    const put = f.mock.calls.find(([u, i]) => String(u) === '/api/settings/ia' && i?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ proveedor: 'bedrock', claveAwsAccessKeyId: 'AKIABEDROCK1', claveAwsSecreto: 'secreto-bedrock-2' })
    expect(document.body.innerHTML).not.toContain('secreto-bedrock-2')
  })
})

describe('Configuración de IA: Ollama', () => {
  it('descarga sola el modelo que falta y Guardar no se bloquea', async () => {
    const M = 'qwen3-vl:4b-instruct'
    const f = mockFetch({
      'GET /api/settings/ia': { body: ajustesIa({ necesitaBienvenida: false, proveedor: 'ollama' }) },
      'GET /api/settings/ia/hardware': { body: hardwareIa({ ollama: { alcanzable: true, version: '0.12.8', modelos: [] } }) },
      'POST /api/settings/ia/ollama/pull': { status: 202, body: { modelo: M, estado: 'descargando' } },
      [`GET /api/settings/ia/ollama/pull?modelo=${encodeURIComponent(M)}`]: { body: { modelo: M, estado: 'descargando', completado: 1, total: 2 } },
    })
    render(
      <MemoryRouter>
        <ToastProvider>
          <ConfiguracionIa />
        </ToastProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Descargando…')).toBeInTheDocument()
    expect(f.mock.calls.some(([u, i]) => String(u) === '/api/settings/ia/ollama/pull' && i?.method === 'POST')).toBe(true)
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  })
})
