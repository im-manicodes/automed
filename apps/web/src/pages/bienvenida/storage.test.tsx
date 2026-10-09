import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import { ajustesAlmacenamiento } from '../../test/ajustesAlmacenamiento'
import { ajustesIa, hardwareIa } from '../../test/ajustesIa'
import { ajustesOcr } from '../../test/ajustesOcr'
import { mockFetch, type MockHandler } from '../../test/mockFetch'
import Bienvenida from './page'

afterEach(() => vi.unstubAllGlobals())

function rutas(alm: MockHandler, extra: Record<string, MockHandler> = {}) {
  return {
    'GET /api/settings/ia': { body: ajustesIa() },
    'GET /api/settings/ia/hardware': { body: hardwareIa() },
    'GET /api/settings/ocr': { body: ajustesOcr() },
    'GET /api/settings/storage': alm,
    ...extra,
  }
}

async function irAlPasoAlmacenamiento() {
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
  const sig = () => screen.getByRole('button', { name: /Siguiente/ })
  await user.click(await screen.findByRole('button', { name: /Siguiente/ }))
  await user.click(screen.getByRole('radio', { name: /configuración actual del servidor/ }))
  await user.click(sig())
  await screen.findByText('¿Cómo leemos tus PDFs escaneados?')
  await user.click(sig())
  await screen.findByText('¿Dónde guardamos tus archivos?')
  return { user, sig }
}

describe('Asistente: almacenamiento', () => {
  it('sin configurar bloquea Siguiente hasta que la prueba sea correcta y guarda al avanzar', async () => {
    const f = mockFetch(
      rutas(
        { body: ajustesAlmacenamiento({ configurado: false, origen: 'ninguno', proveedor: null, rustfs: { endpoint: '', bucket: '', accessKey: '', tieneSecreto: false } }) },
        {
          'POST /api/settings/storage/test': { body: { ok: true, mensaje: 'Bucket accesible' } },
          'PUT /api/settings/storage': { body: ajustesAlmacenamiento({ origen: 'panel' }) },
        },
      ),
    )
    const { user, sig } = await irAlPasoAlmacenamiento()
    expect(sig()).toBeDisabled()
    await user.type(screen.getByLabelText('Dirección del servidor'), 'http://mi-servidor:9000')
    await user.type(screen.getByLabelText('Bucket'), 'archivos')
    await user.type(screen.getByLabelText('Clave de acceso'), 'acceso')
    await user.type(screen.getByLabelText('Clave secreta'), 'secreto-xyz-789')
    expect(sig()).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Probar conexión' }))
    expect(await screen.findByText(/Funciona/)).toBeInTheDocument()
    expect(sig()).toBeEnabled()
    await user.click(sig())
    await screen.findByText('Todo listo')
    const put = f.mock.calls.find(([, i]) => i?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ proveedor: 'rustfs', rustfs: { endpoint: 'http://mi-servidor:9000', secretKey: 'secreto-xyz-789' } })
    expect(document.body.innerHTML).not.toContain('secreto-xyz-789')
  })

  it('una prueba fallida mantiene Siguiente bloqueado', async () => {
    mockFetch(
      rutas(
        { body: ajustesAlmacenamiento({ configurado: false, origen: 'ninguno', proveedor: null }) },
        { 'POST /api/settings/storage/test': { body: { ok: false, mensaje: 'No se pudo conectar' } } },
      ),
    )
    const { user, sig } = await irAlPasoAlmacenamiento()
    await user.type(screen.getByLabelText('Dirección del servidor'), 'http://x:9000')
    await user.type(screen.getByLabelText('Bucket'), 'b')
    await user.type(screen.getByLabelText('Clave de acceso'), 'a')
    await user.type(screen.getByLabelText('Clave secreta'), 's')
    await user.click(screen.getByRole('button', { name: 'Probar conexión' }))
    expect(await screen.findByText('No se pudo conectar')).toBeInTheDocument()
    expect(sig()).toBeDisabled()
  })
})
