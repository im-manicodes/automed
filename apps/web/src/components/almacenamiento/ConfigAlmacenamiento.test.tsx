import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { borradorAlmacenamientoDesde } from '../../lib/almacenamiento'
import type { AjustesAlmacenamiento } from '../../lib/api'
import { ajustesAlmacenamiento } from '../../test/ajustesAlmacenamiento'
import { mockFetch } from '../../test/mockFetch'
import ConfigAlmacenamiento from './ConfigAlmacenamiento'

function Envoltura({ ajustes }: { ajustes: AjustesAlmacenamiento }) {
  const [b, setB] = useState(() => borradorAlmacenamientoDesde(ajustes))
  return <ConfigAlmacenamiento ajustes={ajustes} borrador={b} onChange={setB} />
}

afterEach(() => vi.unstubAllGlobals())

describe('ConfigAlmacenamiento', () => {
  it('muestra el aviso, no revela el secreto guardado y lo conserva al probar', async () => {
    const f = mockFetch({ 'POST /api/settings/storage/test': { body: { ok: true, mensaje: 'Listo' } } })
    render(<Envoltura ajustes={ajustesAlmacenamiento()} />)
    const user = userEvent.setup()
    expect(screen.getByText(/los archivos ya guardados NO se mueven/)).toBeInTheDocument()
    expect(screen.getByLabelText('Clave secreta')).toHaveValue('')
    expect(screen.getByText('Clave secreta guardada')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Probar conexión' }))
    expect(await screen.findByText('Funciona. Listo')).toBeInTheDocument()
    const body = JSON.parse(String(f.mock.calls[0][1]?.body))
    expect(body).toEqual({ proveedor: 'rustfs', rustfs: { endpoint: 'http://rustfs:9000', bucket: 'auto-med', accessKey: 'rustfsadmin' } })
  })

  it('AWS S3: claves opcionales, solo exige región y bucket', async () => {
    const f = mockFetch({ 'POST /api/settings/storage/test': { body: { ok: true, mensaje: 'ok' } } })
    render(<Envoltura ajustes={ajustesAlmacenamiento()} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: /AWS S3/ }))
    expect(screen.getByText(/rol de AWS \(IAM\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Probar conexión' })).toBeDisabled()
    await user.type(screen.getByLabelText('Bucket'), 'mi-bucket')
    await user.click(screen.getByRole('button', { name: 'Probar conexión' }))
    await screen.findByText(/Funciona/)
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ proveedor: 's3', s3: { region: 'us-east-1', bucket: 'mi-bucket' } })
  })
})
