import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../../context/toasts'
import { ajustesAlmacenamiento } from '../../test/ajustesAlmacenamiento'
import { mockFetch } from '../../test/mockFetch'
import Almacenamiento from './page'

afterEach(() => vi.unstubAllGlobals())

function renderPage() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <Almacenamiento />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('Ajustes: almacenamiento', () => {
  it('carga la config, no muestra el secreto y guarda al cambiar a AWS S3', async () => {
    const f = mockFetch({
      'GET /api/settings/storage': { body: ajustesAlmacenamiento() },
      'PUT /api/settings/storage': { body: ajustesAlmacenamiento({ origen: 'panel', proveedor: 's3', s3: { region: 'eu-west-1', bucket: 'mi-bucket', accessKeyId: '', endpoint: '', tieneSecreto: false } }) },
    })
    renderPage()
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Dirección del servidor')).toHaveValue('http://rustfs:9000')
    expect(screen.getByLabelText('Clave secreta')).toHaveValue('')
    await user.click(screen.getByRole('radio', { name: /AWS S3/ }))
    const region = screen.getByLabelText('Región')
    await user.clear(region)
    await user.type(region, 'eu-west-1')
    await user.type(screen.getByLabelText('Bucket'), 'mi-bucket')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await screen.findByText('Almacenamiento guardado.')
    const put = f.mock.calls.find(([, i]) => i?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ proveedor: 's3', s3: { region: 'eu-west-1', bucket: 'mi-bucket' } })
    await waitFor(() => expect(screen.getByLabelText('Región')).toHaveValue('eu-west-1'))
  })

  it('con RustFS escribe la clave secreta nueva y no queda en pantalla tras guardar', async () => {
    const f = mockFetch({
      'GET /api/settings/storage': { body: ajustesAlmacenamiento() },
      'PUT /api/settings/storage': { body: ajustesAlmacenamiento({ origen: 'panel' }) },
    })
    renderPage()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Clave secreta'), 'nuevo-secreto-1')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await screen.findByText('Almacenamiento guardado.')
    const put = f.mock.calls.find(([, i]) => i?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body)).rustfs.secretKey).toBe('nuevo-secreto-1')
    expect(screen.getByLabelText('Clave secreta')).toHaveValue('')
    expect(document.body.innerHTML).not.toContain('nuevo-secreto-1')
  })
})
