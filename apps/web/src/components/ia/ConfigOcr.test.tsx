import { render, screen } from '@testing-library/react'
import { ajustesOcr } from '../../test/ajustesOcr'
import { mockFetch } from '../../test/mockFetch'
import ConfigOcr from './ConfigOcr'

afterEach(() => vi.unstubAllGlobals())
const props = { awsGuardada: false, claves: {}, onClaves: () => {}, onRecheck: () => {}, onMotor: () => {} }

describe('ConfigOcr', () => {
  it('en servidor con local muestra el panel del servicio', () => {
    mockFetch({})
    render(<ConfigOcr {...props} motor="local" ajustes={ajustesOcr({ entorno: { servidor: true }, servicioLocal: { estado: 'detenido' } })} />)
    expect(screen.getByRole('button', { name: 'Probar de nuevo' })).toBeInTheDocument()
  })
})
