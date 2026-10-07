import { render, screen } from '@testing-library/react'
import SelectorOcr from './SelectorOcr'

describe('SelectorOcr', () => {
  it('local se puede elegir en servidor', () => {
    render(<SelectorOcr value="ninguno" onChange={() => {}} entorno={{ escritorio: false, servidor: true, so: 'linux' }} />)
    expect(screen.getByRole('radio', { name: /En mi computador/ })).toBeEnabled()
    expect(screen.queryByText(/No disponible/)).not.toBeInTheDocument()
  })
  it('local se bloquea si no es escritorio ni servidor', () => {
    render(<SelectorOcr value="ninguno" onChange={() => {}} entorno={{ escritorio: false, servidor: false, so: 'otro' }} />)
    expect(screen.getByRole('radio', { name: /En mi computador/ })).toBeDisabled()
  })
})
