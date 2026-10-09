import { render, screen, fireEvent } from '@testing-library/react'
import AvanzadoOcr from './AvanzadoOcr'

const valor = { visionRetry: true, visionMaxRegions: 40, renderDpi: 200, textractMode: 'detect' as const }

describe('AvanzadoOcr', () => {
  it('muestra los controles y emite los cambios', () => {
    const onChange = vi.fn()
    render(<AvanzadoOcr motor="local" valor={valor} onChange={onChange} />)
    expect(screen.getByText(/Usa un modelo con visión/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Modo')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: /Releer con IA/ }))
    expect(onChange).toHaveBeenLastCalledWith({ ...valor, visionRetry: false })
    fireEvent.change(screen.getByLabelText('Máximo de partes a releer'), { target: { value: '80' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...valor, visionMaxRegions: 80 })
    fireEvent.change(screen.getByLabelText('Calidad de lectura'), { target: { value: '300' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...valor, renderDpi: 300 })
  })

  it('con Textract permite elegir el modo', () => {
    const onChange = vi.fn()
    render(<AvanzadoOcr motor="textract" valor={valor} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Modo'), { target: { value: 'analyze' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...valor, textractMode: 'analyze' })
  })
})
