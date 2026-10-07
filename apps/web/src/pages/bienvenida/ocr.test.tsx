import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import type { AjustesOcr, ProgresoPython } from '../../lib/api'
import * as clipboard from '../../lib/clipboard'
import { ajustesIa, hardwareIa } from '../../test/ajustesIa'
import { ajustesOcr, pythonViejo, sinPython } from '../../test/ajustesOcr'
import { callsOf, mockFetch, type MockHandler } from '../../test/mockFetch'
import Bienvenida from './page'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function rutas(ocr: MockHandler, extra: Record<string, MockHandler> = {}) {
  return {
    'GET /api/settings/ia': { body: ajustesIa() },
    'GET /api/settings/ia/hardware': { body: hardwareIa() },
    'GET /api/settings/ocr': ocr,
    'PUT /api/settings/ocr': (req: { body: unknown }) => ({ body: ajustesOcr({ motor: (req.body as { motor: AjustesOcr['motor'] }).motor }) }),
    'PUT /api/settings/ia': { body: ajustesIa({ claves: { openai: false, anthropic: false, aws: true } }) },
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
  it('Python no encontrado: muestra la guía con comandos copiables y bloquea Siguiente', async () => {
    mockFetch(rutas({ body: sinPython() }))
    const copiar = vi.spyOn(clipboard, 'copiarTexto').mockResolvedValue(true)
    const user = await irAlPasoOcr()
    await user.click(screen.getByRole('radio', { name: /En mi computador/ }))

    expect(screen.getByText(/No encontramos Python/)).toBeInTheDocument()
    expect(screen.getByText('Instalar Python 3.11 en Linux')).toBeInTheDocument()
    expect(screen.getByText('Abre una terminal.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Descargar Python/ })).toHaveAttribute('href', 'https://www.python.org/downloads/')
    expect(siguiente()).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /Copiar comando: sudo apt install/ }))
    expect(copiar).toHaveBeenCalledWith('sudo apt install python3.11 python3.11-venv')
    expect(await screen.findByText('Copiado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verificar de nuevo' })).toBeInTheDocument()
  })

  it('"Verificar de nuevo" vuelve a consultar y detecta Python', async () => {
    let n = 0
    const f = mockFetch(rutas(() => ({ body: ++n === 1 ? sinPython() : ajustesOcr() })))
    const user = await irAlPasoOcr()
    await user.click(screen.getByRole('radio', { name: /En mi computador/ }))
    await user.click(screen.getByRole('button', { name: 'Verificar de nuevo' }))
    expect(await screen.findByText(/Python 3.11.9 es compatible/)).toBeInTheDocument()
    expect(callsOf(f).filter((c) => c === 'GET /api/settings/ocr').length).toBeGreaterThanOrEqual(2)
  })

  it('versión no compatible: explica el motivo y muestra la guía', async () => {
    mockFetch(rutas({ body: pythonViejo() }))
    const user = await irAlPasoOcr()
    await user.click(screen.getByRole('radio', { name: /En mi computador/ }))
    expect(screen.getByText(/Encontramos Python 3.8.10/)).toBeInTheDocument()
    expect(screen.getByText(/Es una versión muy antigua/)).toBeInTheDocument()
    expect(screen.getByText('Instalar una versión más nueva de Python')).toBeInTheDocument()
    expect(siguiente()).toBeDisabled()
  })

  it('compatible: prepara el OCR, muestra el progreso por polling y habilita Siguiente', async () => {
    let listo = false
    let consultas = 0
    const f = mockFetch(
      rutas(() => ({ body: ajustesOcr({ entornoPython: { estado: listo ? 'listo' : 'sin_preparar' } }) }), {
        'POST /api/settings/ocr/python/instalar': { status: 202, body: { estado: 'preparando' } },
        'GET /api/settings/ocr/python/progreso': () => {
          consultas++
          const p: ProgresoPython = consultas < 4
            ? { estado: 'preparando', lineas: ['Creando el entorno…'] }
            : { estado: 'listo', lineas: ['Creando el entorno…', 'Listo'] }
          if (p.estado === 'listo') listo = true
          return { body: p }
        },
      }),
    )
    const user = await irAlPasoOcr()
    await user.click(screen.getByRole('radio', { name: /En mi computador/ }))
    expect(screen.getByText(/más de 1 GB/)).toBeInTheDocument()
    expect(siguiente()).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Preparar el OCR' }))
    expect(await screen.findByText('Creando el entorno…')).toBeInTheDocument()
    expect(await screen.findByText('El OCR está preparado.', {}, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(() => expect(siguiente()).toBeEnabled())

    await user.click(siguiente())
    await screen.findByText('Todo listo')
    expect(putsA(f, '/api/settings/ocr')).toEqual([{ motor: 'local' }])
  })

  it('error al preparar: muestra el mensaje en español y permite reintentar', async () => {
    mockFetch(
      rutas({ body: ajustesOcr() }, {
        'POST /api/settings/ocr/python/instalar': { status: 202, body: { estado: 'preparando' } },
        'GET /api/settings/ocr/python/progreso': { body: { estado: 'error', lineas: ['pip falló'], mensaje: 'No hay internet para descargar los paquetes.' } },
      }),
    )
    const user = await irAlPasoOcr()
    await user.click(screen.getByRole('radio', { name: /En mi computador/ }))
    await user.click(screen.getByRole('button', { name: 'Preparar el OCR' }))
    expect(await screen.findByText('No hay internet para descargar los paquetes.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled()
    expect(siguiente()).toBeDisabled()
    // Salida clara: elegir "Configurar después".
    await user.click(screen.getByRole('radio', { name: /Configurar después/ }))
    expect(siguiente()).toBeEnabled()
  })

  it('un 409 al instalar muestra el mensaje del servidor', async () => {
    mockFetch(rutas({ body: ajustesOcr() }, { 'POST /api/settings/ocr/python/instalar': { status: 409, body: { message: 'Este Python no es compatible.' } } }))
    const user = await irAlPasoOcr()
    await user.click(screen.getByRole('radio', { name: /En mi computador/ }))
    await user.click(screen.getByRole('button', { name: 'Preparar el OCR' }))
    expect(await screen.findByText('Este Python no es compatible.')).toBeInTheDocument()
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
    await screen.findByText('Todo listo')
    expect(putsA(f, '/api/settings/ocr').every((b) => b.motor === 'textract')).toBe(true)
    expect(putsA(f, '/api/settings/ia')).toHaveLength(1) // no se vuelven a enviar
  })

  it('Textract con claves ya guardadas permite avanzar sin escribirlas', async () => {
    mockFetch({ ...rutas({ body: ajustesOcr() }), 'GET /api/settings/ia': { body: ajustesIa({ claves: { openai: false, anthropic: false, aws: true } }) } })
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
    await screen.findByText('Todo listo')
    expect(putsA(f, '/api/settings/ocr')).toEqual([])
    expect(putsA(f, '/api/settings/ia')).toEqual([])
  })

  it('fuera de escritorio la opción local está deshabilitada y explica por qué', async () => {
    mockFetch(rutas({ body: ajustesOcr({ entorno: { escritorio: false, so: 'linux' } }) }))
    await irAlPasoOcr()
    expect(screen.getByRole('radio', { name: /En mi computador/ })).toBeDisabled()
    expect(screen.getByText(/solo funciona si la aplicación está instalada en tu computador/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Amazon Textract/ })).toBeEnabled()
  })
})
