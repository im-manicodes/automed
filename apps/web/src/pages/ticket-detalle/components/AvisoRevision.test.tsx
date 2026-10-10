import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AvisoRevision from './AvisoRevision'

const montar = (pendientes: { id: string; filename: string }[], onContinuar = vi.fn()) =>
  render(<MemoryRouter><AvisoRevision threadId="t1" pendientes={pendientes} busy={false} onContinuar={onContinuar} /></MemoryRouter>)

describe('AvisoRevision', () => {
  it('pide revisar antes del resumen y enlaza al primer PDF pendiente', () => {
    montar([{ id: 'a1', filename: 'nota.pdf' }, { id: 'a2', filename: 'otra.pdf' }])
    expect(screen.getByText(/Antes de generar el resumen/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Revisar ahora/ })).toHaveAttribute('href', '/tickets/t1/revision/a1')
  })

  it('permite generar el resumen sin corregir', async () => {
    const onContinuar = vi.fn()
    montar([{ id: 'a1', filename: 'nota.pdf' }], onContinuar)
    await userEvent.click(screen.getByRole('button', { name: 'Generar el resumen sin corregir' }))
    expect(onContinuar).toHaveBeenCalled()
  })

  it('sin PDF pendientes no muestra nada', () => {
    const { container } = montar([])
    expect(container).toBeEmptyDOMElement()
  })
})
