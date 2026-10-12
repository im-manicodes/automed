import { render, screen, fireEvent } from '@testing-library/react'
import AvanzadoOcr from './AvanzadoOcr'

const valor = { visionRetry: true, visionSegundoIntento: true, visionMaxRegions: 40, renderDpi: 200, textractMode: 'detect' as const, visionAmbito: 'Documentos clínicos' }

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

  it('muestra el segundo intento, lo apaga y se deshabilita sin releer con IA', () => {
    const onChange = vi.fn()
    const { unmount } = render(<AvanzadoOcr motor="local" valor={valor} onChange={onChange} />)
    const sw = screen.getByRole('switch', { name: /Segundo intento con otro modelo/ })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Úsalo si solo tienes un modelo/)).toBeInTheDocument()
    fireEvent.click(sw)
    expect(onChange).toHaveBeenLastCalledWith({ ...valor, visionSegundoIntento: false })
    unmount()
    render(<AvanzadoOcr motor="local" valor={{ ...valor, visionRetry: false }} onChange={() => {}} />)
    expect(screen.getByRole('switch', { name: /Segundo intento con otro modelo/ })).toBeDisabled()
  })

  it('edita el tipo de documentos y lo restablece', () => {
    const onChange = vi.fn()
    render(<AvanzadoOcr motor="local" valor={valor} ambitoPorDefecto="Texto original" onChange={onChange} />)
    const campo = screen.getByLabelText('Tipo de documentos (ayuda para leer lo dudoso)')
    expect(campo).toHaveValue('Documentos clínicos')
    fireEvent.change(campo, { target: { value: 'Otros' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...valor, visionAmbito: 'Otros' })
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...valor, visionAmbito: 'Texto original' })
  })

  it('deshabilita el tipo de documentos si no se relee con IA', () => {
    render(<AvanzadoOcr motor="local" valor={{ ...valor, visionRetry: false }} ambitoPorDefecto="x" onChange={() => {}} />)
    expect(screen.getByLabelText('Tipo de documentos (ayuda para leer lo dudoso)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Restablecer' })).toBeDisabled()
  })

  it('con Textract permite elegir el modo', () => {
    const onChange = vi.fn()
    render(<AvanzadoOcr motor="textract" valor={valor} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Modo'), { target: { value: 'analyze' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...valor, textractMode: 'analyze' })
  })
})
