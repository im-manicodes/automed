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
})
