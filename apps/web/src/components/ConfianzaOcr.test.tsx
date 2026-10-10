import { render, screen } from '@testing-library/react'
import ConfianzaOcr from './ConfianzaOcr'
import { infoConfianza } from '../lib/confianza'

describe('ConfianzaOcr', () => {
  it('muestra el nivel y el porcentaje con texto, no solo color', () => {
    render(<ConfianzaOcr nivel="media" confianza={0.812} />)
    expect(screen.getByText('Lectura regular (81 %)')).toBeInTheDocument()
  })

  it('texto digital no lleva porcentaje', () => {
    render(<ConfianzaOcr nivel="digital" confianza={null} />)
    expect(screen.getByText('Texto digital')).toBeInTheDocument()
  })

  it('etiquetas por nivel', () => {
    expect(infoConfianza('alta', 0.95).label).toBe('Lectura clara (95 %)')
    expect(infoConfianza('baja', 0.6).label).toBe('Lectura dudosa (60 %)')
  })
})
