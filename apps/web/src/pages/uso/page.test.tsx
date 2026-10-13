import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import type { Precios, RespuestaPronostico, RespuestaUso } from '../../lib/api'
import { callsOf, mockFetch } from '../../test/mockFetch'
import Uso from './page'

afterEach(() => vi.unstubAllGlobals())

const uso: RespuestaUso = {
  desde: '2026-10-06',
  hasta: '2026-10-12',
  moneda: 'USD',
  totales: { inputTokens: 120000, outputTokens: 8000, cachedTokens: 0, paginasOcr: 4, costo: 1.5 },
  porModelo: [
    { kind: 'llm', provider: 'openai', model: 'gpt-x', task: 'resumen', llamadas: 3, inputTokens: 100000, outputTokens: 5000, cachedTokens: 40000, cacheWriteTokens: 5000, paginas: 0, costo: 1.25, estimado: false },
    { kind: 'llm', provider: 'ollama', model: 'qwen-local', task: 'vision_respaldo', llamadas: 1, inputTokens: 20000, outputTokens: 3000, cachedTokens: 0, paginas: 0, costo: null, estimado: true },
    { kind: 'ocr', provider: 'textract', model: 'textract-detect', task: 'ocr', llamadas: 4, inputTokens: 0, outputTokens: 0, cachedTokens: 0, paginas: 4, costo: 0.25, estimado: false },
  ],
  porDia: [{ fecha: '2026-10-11', costo: 0.5, tokens: 50000 }, { fecha: '2026-10-12', costo: 1, tokens: 78000 }],
  modelosSinPrecio: ['qwen-local'],
}
const pron = (diasConDatos: number): RespuestaPronostico => ({ moneda: 'USD', ventanaDias: 7, diasConDatos, promedioDiario: 0.5, finDeMes: 12.5, proximos30Dias: 15, porModelo: [] })
const precios: Precios = { moneda: 'USD', modelos: { 'gpt-x': { entrada: 2, salida: 8 } }, ocr: { 'textract-detect': 0.0015 } }

function renderPage() {
  render(<MemoryRouter><ToastProvider><Uso /></ToastProvider></MemoryRouter>)
}

describe('Ajustes: uso y costo', () => {
  it('muestra tarjetas, actividades en español, sin precio y pronóstico', async () => {
    mockFetch({
      'GET /api/settings/uso': { body: uso },
      'GET /api/settings/uso/pronostico': { body: pron(5) },
      'GET /api/settings/precios': { body: precios },
    })
    renderPage()
    const lista = await screen.findByRole('list', { name: 'Uso por modelo y actividad' })
    expect(within(lista).getByText('Resumen del ticket')).toBeInTheDocument()
    expect(within(lista).getByText('Segundo intento de zonas dudosas')).toBeInTheDocument()
    expect(within(lista).getByText('OCR de pago (por página)')).toBeInTheDocument()
    expect(within(lista).getByText('Sin precio')).toBeInTheDocument()
    expect(within(lista).getByText(/Caché: 40\D?000 leídos · 5\D?000 escritos/)).toBeInTheDocument()
    expect(screen.getByText(/short\/long context/)).toBeInTheDocument()
    expect(screen.getByText(/Sin precio: qwen-local/)).toBeInTheDocument()
    expect(screen.getByText(/Próximos 30 días/)).toBeInTheDocument()
    expect(screen.queryByText(/pocos días de datos/)).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Costo estimado por día/ })).toBeInTheDocument()
  })

  it('el editor no lista motores OCR como modelos y sí los modelos configurados en Ajustes -> IA', async () => {
    mockFetch({
      'GET /api/settings/uso': { body: { ...uso, modelosSinPrecio: ['qwen-local'], ocrSinPrecio: ['azure-read'] } },
      'GET /api/settings/uso/pronostico': { body: pron(5) },
      'GET /api/settings/precios': { body: { ...precios, modelos: { ...precios.modelos, 'azure-read': { entrada: 0, salida: 0 } } } },
      'GET /api/settings/ia': { body: { modelos: { resumen: 'gpt-6-luna', whatsapp: 'gpt-6-luna', vision: '' } } },
    })
    renderPage()
    expect(await screen.findByLabelText('Entrada (Input) · gpt-6-luna')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Entrada \(Input\) · azure-read/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Entrada \(Input\) · textract-detect/)).not.toBeInTheDocument()
    expect(screen.getByText(/Sin precio por página: azure-read/)).toBeInTheDocument()
    expect(screen.getByLabelText('Azure Document Intelligence')).toBeInTheDocument()
  })

  it('avisa si hay pocos días de datos y cambia de periodo', async () => {
    const f = mockFetch({
      'GET /api/settings/uso': { body: uso },
      'GET /api/settings/uso/pronostico': { body: pron(1) },
      'GET /api/settings/precios': { body: precios },
    })
    renderPage()
    expect(await screen.findByText(/pocos días de datos/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Este mes' }))
    await waitFor(() => expect(callsOf(f)).toContain('GET /api/settings/uso?periodo=mes'))
  })

  it('guarda los precios con PUT', async () => {
    const f = mockFetch({
      'GET /api/settings/uso': { body: uso },
      'GET /api/settings/uso/pronostico': { body: pron(5) },
      'GET /api/settings/precios': { body: precios },
      'PUT /api/settings/precios': { body: precios },
    })
    renderPage()
    const user = userEvent.setup()
    const entrada = await screen.findByLabelText('Entrada (Input) · qwen-local')
    await user.type(entrada, '0')
    await user.type(screen.getByLabelText('Salida (Output) · qwen-local'), '0')
    await user.type(screen.getByLabelText('Escritura en caché (Cache writes) · qwen-local'), '1,5')
    await user.type(screen.getByLabelText('Entrada en caché (Cached input) · qwen-local'), '0.1')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(callsOf(f)).toContain('PUT /api/settings/precios'))
    const put = f.mock.calls.find(([, i]) => i?.method === 'PUT')!
    expect(JSON.parse(String(put[1]!.body))).toEqual({
      modelos: { 'gpt-x': { entrada: 2, salida: 8 }, 'qwen-local': { entrada: 0, salida: 0, cacheada: 0.1, escrituraCache: 1.5 } },
      ocr: { 'textract-detect': 0.0015 },
    })
  })
})
