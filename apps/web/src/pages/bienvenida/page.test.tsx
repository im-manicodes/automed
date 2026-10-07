import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import { ajustesIa, hardwareIa } from '../../test/ajustesIa'
import { mockFetch, type MockHandler } from '../../test/mockFetch'
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

function rutas(hw: MockHandler = { body: hardwareIa() }) {
  return {
    'GET /api/settings/ia': { body: ajustesIa() },
    'GET /api/settings/ia/hardware': hw,
    'PUT /api/settings/ia': { body: ajustesIa({ necesitaBienvenida: false, proveedor: 'openai', claves: { openai: true, anthropic: false } }) },
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
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))

    expect(screen.getByText('Todo listo')).toBeInTheDocument()
    expect(screen.queryByText('sk-secreta-123')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Conectar Outlook' }))

    await waitFor(() => expect(screen.getByTestId('ubicacion')).toHaveTextContent('/ajustes'))
    const [body] = puts(f)
    expect(body).toMatchObject({ proveedor: 'openai', claveOpenai: 'sk-secreta-123', bienvenidaCompletada: true })
    expect(body.modelos.resumen).toBe('gpt-4o-mini')
    expect(document.body.innerHTML).not.toContain('sk-secreta-123')
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
    await user.click(await screen.findByRole('button', { name: 'Ir a mis tickets' }))
    await waitFor(() => expect(screen.getByTestId('ubicacion')).toHaveTextContent('/tickets'))
    expect(puts(f)).toEqual([{ bienvenidaCompletada: true }])
  })
})
