import { render, screen } from '@testing-library/react'
import { ajustesOcr } from '../../test/ajustesOcr'
import { mockFetch } from '../../test/mockFetch'
import ConfigOcr from './ConfigOcr'

afterEach(() => vi.unstubAllGlobals())
const props = { awsGuardada: false, claves: {}, onClaves: () => {}, onRecheck: () => {}, onMotor: () => {} }

describe('ConfigOcr', () => {
  it('en servidor con local muestra el panel del servicio y no el de Python', () => {
    mockFetch({})
    render(<ConfigOcr {...props} motor="local" ajustes={ajustesOcr({ entorno: { escritorio: false, servidor: true, so: 'linux' }, servicioLocal: { estado: 'detenido' } })} />)
    expect(screen.getByRole('button', { name: 'Probar de nuevo' })).toBeInTheDocument()
    expect(screen.queryByText(/Python/)).not.toBeInTheDocument()
  })
  it('en escritorio con local muestra Python', () => {
    mockFetch({})
    render(<ConfigOcr {...props} motor="local" ajustes={ajustesOcr()} />)
    expect(screen.getByText(/Python 3.11.9 es compatible/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Probar de nuevo' })).not.toBeInTheDocument()
  })
})
