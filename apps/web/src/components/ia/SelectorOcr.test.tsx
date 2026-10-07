import { render, screen } from '@testing-library/react'
import SelectorOcr from './SelectorOcr'

describe('SelectorOcr', () => {
  it('local se puede elegir en servidor', () => {
    render(<SelectorOcr value="ninguno" onChange={() => {}} entorno={{ servidor: true }} />)
    expect(screen.getByRole('radio', { name: /En mi computador/ })).toBeEnabled()
    expect(screen.queryByText(/No disponible/)).not.toBeInTheDocument()
  })
  it('local se bloquea si no hay servicio de OCR', () => {
    render(<SelectorOcr value="ninguno" onChange={() => {}} entorno={{ servidor: false }} />)
    expect(screen.getByRole('radio', { name: /En mi computador/ })).toBeDisabled()
  })
})
