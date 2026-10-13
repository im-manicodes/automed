import { render, screen, fireEvent } from '@testing-library/react'
import { ajustesIa } from '../../test/ajustesIa'
import ModeloPorTarea from './ModeloPorTarea'

describe('ModeloPorTarea', () => {
  it('con Ollama marca como recomendado el primer modelo sugerido (Qwen3-VL 4B)', () => {
    const a = ajustesIa()
    render(<ModeloPorTarea proveedor="ollama" modelos={a.modelos} sugeridos={a.sugeridos.ollama} onChange={() => {}} />)
    expect(screen.getAllByRole('option', { name: 'qwen3-vl:4b-instruct (recomendado)' }).length).toBeGreaterThan(0)
  })

  it('con otros proveedores no marca ninguno como recomendado', () => {
    const a = ajustesIa({ proveedor: 'openai', modelos: { resumen: 'gpt-5', whatsapp: 'gpt-5', evento: 'gpt-5', reporte: 'gpt-5', vision: 'gpt-5', vision_respaldo: 'gpt-5', vision_sugerencias: 'gpt-5' } })
    render(<ModeloPorTarea proveedor="openai" modelos={a.modelos} sugeridos={a.sugeridos.openai} onChange={() => {}} />)
    expect(screen.queryByRole('option', { name: /recomendado/ })).not.toBeInTheDocument()
  })

  it('muestra la fila del segundo intento con su ayuda y la lista de modelos de visión', () => {
    const a = ajustesIa({ proveedor: 'openai', modelos: { resumen: 'gpt-4o-mini', whatsapp: 'gpt-4o-mini', evento: 'gpt-4o-mini', reporte: 'gpt-4o-mini', vision: 'gpt-4o', vision_respaldo: 'gpt-4o', vision_sugerencias: 'gpt-4o' } })
    render(<ModeloPorTarea proveedor="openai" modelos={a.modelos} sugeridos={a.sugeridos.openai} onChange={() => {}} />)
    expect(screen.getByText('Si lo dejas vacío usa el mismo modelo de lectura de zonas')).toBeInTheDocument()
    const sel = screen.getByLabelText('Segundo intento de zonas dudosas (visión)')
    expect(sel).toHaveValue('gpt-4o')
    expect(Array.from((sel as HTMLSelectElement).options).map((o) => o.value)).not.toContain('gpt-4o-mini')
  })

  it('muestra interruptores solo para segundo intento y sugerencias, y los emite', () => {
    const a = ajustesIa()
    const onActivar = vi.fn()
    render(<ModeloPorTarea proveedor="ollama" modelos={a.modelos} sugeridos={a.sugeridos.ollama} onChange={() => {}} activas={{ segundoIntento: true, sugerencias: true }} onActivar={onActivar} />)
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    fireEvent.click(screen.getByRole('switch', { name: /Sugerencias al revisar una duda/ }))
    expect(onActivar).toHaveBeenCalledWith('sugerencias', false)
  })

  it('con el interruptor apagado atenúa la fila, deshabilita el selector y dice «Desactivado»', () => {
    const a = ajustesIa()
    render(<ModeloPorTarea proveedor="ollama" modelos={a.modelos} sugeridos={a.sugeridos.ollama} onChange={() => {}} activas={{ segundoIntento: false, sugerencias: true }} onActivar={() => {}} />)
    expect(screen.getByLabelText('Segundo intento de zonas dudosas (visión)')).toBeDisabled()
    expect(screen.getByLabelText('Sugerencias al revisar una duda (visión)')).toBeEnabled()
    expect(screen.getAllByText('Desactivado')).toHaveLength(1)
  })
})
