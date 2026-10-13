import { render, screen } from '@testing-library/react'
import { ajustesIa } from '../../test/ajustesIa'
import ModeloPorTarea from './ModeloPorTarea'

describe('ModeloPorTarea', () => {
  it('con Ollama marca como recomendado el primer modelo sugerido (Qwen3-VL 4B)', () => {
    const a = ajustesIa()
    render(<ModeloPorTarea proveedor="ollama" modelos={a.modelos} sugeridos={a.sugeridos.ollama} onChange={() => {}} />)
    expect(screen.getAllByRole('option', { name: 'qwen3-vl:4b-instruct (recomendado)' }).length).toBeGreaterThan(0)
  })

  it('con otros proveedores no marca ninguno como recomendado', () => {
    const a = ajustesIa({ proveedor: 'openai', modelos: { resumen: 'gpt-5', whatsapp: 'gpt-5', evento: 'gpt-5', reporte: 'gpt-5', vision: 'gpt-5' } })
    render(<ModeloPorTarea proveedor="openai" modelos={a.modelos} sugeridos={a.sugeridos.openai} onChange={() => {}} />)
    expect(screen.queryByRole('option', { name: /recomendado/ })).not.toBeInTheDocument()
  })

  it('muestra la fila de visión con su ayuda y la lista de modelos de visión', () => {
    const a = ajustesIa({ proveedor: 'openai', modelos: { resumen: 'gpt-4o-mini', whatsapp: 'gpt-4o-mini', evento: 'gpt-4o-mini', reporte: 'gpt-4o-mini', vision: 'gpt-4o' } })
    render(<ModeloPorTarea proveedor="openai" modelos={a.modelos} sugeridos={a.sugeridos.openai} onChange={() => {}} />)
    expect(screen.getByText(/Una sola pasada: lee las zonas dudosas y deja 2 sugerencias/)).toBeInTheDocument()
    const sel = screen.getByLabelText('Lectura de zonas dudosas (visión)')
    expect(sel).toHaveValue('gpt-4o')
    expect(Array.from((sel as HTMLSelectElement).options).map((o) => o.value)).not.toContain('gpt-4o-mini')
  })

  it('no muestra interruptores', () => {
    const a = ajustesIa()
    render(<ModeloPorTarea proveedor="ollama" modelos={a.modelos} sugeridos={a.sugeridos.ollama} onChange={() => {}} />)
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })
})
