import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import type { AjustesOcr } from '../../lib/api'
import { ajustesIa, hardwareIa } from '../../test/ajustesIa'
import { ajustesAlmacenamiento } from '../../test/ajustesAlmacenamiento'
import { ajustesOcr } from '../../test/ajustesOcr'
import { mockFetch, type MockHandler } from '../../test/mockFetch'
import Bienvenida from './page'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function rutas(ocr: MockHandler, extra: Record<string, MockHandler> = {}) {
  return {
    'GET /api/settings/ia': { body: ajustesIa() },
    'GET /api/settings/ia/hardware': { body: hardwareIa() },
    'GET /api/settings/storage': { body: ajustesAlmacenamiento() },
    'GET /api/settings/ocr': ocr,
    'PUT /api/settings/ocr': (req: { body: unknown }) => ({ body: ajustesOcr({ motor: (req.body as { motor: AjustesOcr['motor'] }).motor }) }),
    'PUT /api/settings/ia': { body: ajustesIa({ claves: { openai: false, anthropic: false, aws: true, foundry: false } }) },
    ...extra,
  }
}

/** Abre el asistente y avanza (con la config del servidor) hasta el paso de lectura de PDFs. */
async function irAlPasoOcr() {
  render(
    <MemoryRouter initialEntries={['/bienvenida']}>
      <ToastProvider>
        <Routes>
          <Route path="/bienvenida" element={<Bienvenida />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /Siguiente/ }))
  await user.click(screen.getByRole('radio', { name: /configuración actual del servidor/ }))
  await user.click(screen.getByRole('button', { name: /Siguiente/ }))
  await screen.findByText('¿Cómo leemos tus PDFs escaneados?')
  return user
}

const siguiente = () => screen.getByRole('button', { name: /Siguiente/ })
const putsA = (f: ReturnType<typeof mockFetch>, url: string) =>
  f.mock.calls.filter(([u, i]) => String(u) === url && i?.method === 'PUT').map(([, i]) => JSON.parse(String(i?.body)))

describe('Asistente: lectura de PDFs escaneados', () => {
  it('local con el servicio detenido bloquea Siguiente; con el servicio listo lo habilita', async () => {
    let n = 0
    mockFetch(rutas(() => ({ body: ajustesOcr({ servicioLocal: { estado: ++n === 1 ? 'detenido' : 'listo' } }) })))
    const user = await irAlPasoOcr()
    await user.click(screen.getByRole('radio', { name: /En mi computador/ }))
    expect(siguiente()).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Probar de nuevo' }))
    await waitFor(() => expect(siguiente()).toBeEnabled())
  })

  it('Textract sin claves bloquea Siguiente; con claves guarda, prueba y no deja las claves en pantalla', async () => {
    const f = mockFetch(rutas({ body: ajustesOcr() }, { 'POST /api/settings/ocr/probar': { body: { ok: true, ms: 250, mensaje: 'ok' } } }))
    const user = await irAlPasoOcr()
    await user.click(screen.getByRole('radio', { name: /Amazon Textract/ }))
    expect(siguiente()).toBeDisabled()

    await user.type(screen.getByLabelText('ID de clave de acceso de AWS'), 'AKIAEJEMPLO123')
    expect(siguiente()).toBeDisabled() // falta el secreto
    await user.type(screen.getByLabelText('Clave secreta de AWS'), 'secreto-muy-largo-456')
    expect(siguiente()).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Probar Textract' }))
    expect(await screen.findByText('Funciona (250 ms)')).toBeInTheDocument()
    expect(putsA(f, '/api/settings/ia')).toEqual([{ claveAwsAccessKeyId: 'AKIAEJEMPLO123', claveAwsSecreto: 'secreto-muy-largo-456' }])

    await waitFor(() => expect(screen.queryByDisplayValue('AKIAEJEMPLO123')).toBeNull())
    expect(screen.getByText('Ya hay una clave guardada')).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('AKIAEJEMPLO123')
    expect(document.body.innerHTML).not.toContain('secreto-muy-largo-456')
    expect(siguiente()).toBeEnabled()

    await user.click(siguiente())
    await screen.findByText('¿Dónde guardamos tus archivos?')
    await user.click(siguiente())
    await screen.findByText('Todo listo')
    expect(putsA(f, '/api/settings/ocr').every((b) => b.motor === 'textract')).toBe(true)
    expect(putsA(f, '/api/settings/ia')).toHaveLength(1) // no se vuelven a enviar
  })

  it('Textract con claves ya guardadas permite avanzar sin escribirlas', async () => {
    mockFetch({ ...rutas({ body: ajustesOcr() }), 'GET /api/settings/ia': { body: ajustesIa({ claves: { openai: false, anthropic: false, aws: true, foundry: false } }) } })
    const user = await irAlPasoOcr()
    await user.click(screen.getByRole('radio', { name: /Amazon Textract/ }))
    expect(screen.getByText('Ya hay una clave guardada')).toBeInTheDocument()
    expect(siguiente()).toBeEnabled()
  })

  it('"Configurar después" avanza sin guardar nada del OCR', async () => {
    const f = mockFetch(rutas({ body: ajustesOcr() }))
    const user = await irAlPasoOcr()
    expect(screen.getByRole('radio', { name: /Configurar después/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(siguiente())
    await screen.findByText('¿Dónde guardamos tus archivos?')
    await user.click(siguiente())
    await screen.findByText('Todo listo')
    expect(putsA(f, '/api/settings/ocr')).toEqual([])
    expect(putsA(f, '/api/settings/ia')).toEqual([])
  })

  it('en servidor la opción local se puede elegir', async () => {
    mockFetch(rutas({ body: ajustesOcr() }))
    await irAlPasoOcr()
    expect(screen.getByRole('radio', { name: /En mi computador/ })).toBeEnabled()
    expect(screen.queryByText(/No disponible aquí/)).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Amazon Textract/ })).toBeEnabled()
  })
})
