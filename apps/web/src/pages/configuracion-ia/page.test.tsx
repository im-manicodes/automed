import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import { ajustesIa, hardwareIa } from '../../test/ajustesIa'
import { mockFetch } from '../../test/mockFetch'
import ConfiguracionIa from './page'

afterEach(() => vi.unstubAllGlobals())

describe('Configuración de IA', () => {
  it('carga, edita un modelo, guarda y prueba', async () => {
    const actual = ajustesIa({ necesitaBienvenida: false, proveedor: 'openai', claves: { openai: true, anthropic: false } })
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
    await user.click(screen.getByRole('button', { name: /Guardar/ }))

    await waitFor(() => expect(screen.getByText('Cambios guardados.')).toBeInTheDocument())
    const put = f.mock.calls.find(([, i]) => i?.method === 'PUT')
    const body = JSON.parse(String(put?.[1]?.body))
    expect(body.modelos.reporte).toBe('gpt-4o')
    expect(body.proveedor).toBe('openai')
    expect(body).not.toHaveProperty('claveOpenai')
    expect(body).not.toHaveProperty('bienvenidaCompletada')
  })
})
