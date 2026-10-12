import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EtapaProgreso, ProgresoAnalisis } from '../../../lib/api'
import EtapasAnalisis from './EtapasAnalisis'

const p = (etapa: EtapaProgreso, extra: Partial<ProgresoAnalisis> = {}): ProgresoAnalisis => ({
  etapa, porcentaje: 30, adjuntos: { total: 1, listos: 0 }, ...extra,
})
const estado = (t: string) => screen.getByText(t).closest('li')?.getAttribute('data-estado')

describe('EtapasAnalisis', () => {
  it('es una región de estado accesible', () => {
    render(<EtapasAnalisis progreso={p('escaneando_ocr')} />)
    const r = screen.getByRole('status')
    expect(r).toHaveAttribute('aria-live', 'polite')
  })

  it('escaneando: paso 1 actual con páginas; sin pasos 3 ni 4', () => {
    render(<EtapasAnalisis progreso={p('escaneando_ocr', { paginas: { total: 6, leidas: 2 } })} />)
    expect(estado('Escaneando el PDF con OCR')).toBe('actual')
    expect(estado('Generando el resumen')).toBe('pendiente')
    expect(screen.getByText('Páginas leídas: 2 de 6')).toBeInTheDocument()
    expect(screen.queryByText('Procesando las partes dudosas')).not.toBeInTheDocument()
    expect(screen.queryByText('Revisión manual')).not.toBeInTheDocument()
  })

  it('procesando dudosas: aparece el paso 3 con el contador de zonas', () => {
    render(<EtapasAnalisis progreso={p('procesando_dudosas', { regiones: { total: 4, hechas: 1 } })} />)
    expect(estado('Pasando a la IA las partes dudosas')).toBe('hecho')
    expect(estado('Procesando las partes dudosas')).toBe('actual')
    expect(screen.getByText('Zona 2 de 4')).toBeInTheDocument()
  })

  it('el paso 3 sigue visible (hecho) después de haber estado activo', () => {
    const { rerender } = render(<EtapasAnalisis progreso={p('procesando_dudosas')} />)
    rerender(<EtapasAnalisis progreso={p('generando_resumen')} />)
    expect(estado('Procesando las partes dudosas')).toBe('hecho')
    expect(estado('Generando el resumen')).toBe('actual')
  })

  it('revisión manual: aparece el paso 4 como actual', () => {
    render(<EtapasAnalisis progreso={p('revision_manual')} />)
    expect(estado('Revisión manual')).toBe('actual')
    expect(estado('Generando el resumen')).toBe('pendiente')
  })

  it('resumen listo: todo hecho y sin paso 4', () => {
    render(<EtapasAnalisis progreso={p('resumen_listo')} />)
    expect(estado('Resumen generado')).toBe('hecho')
    expect(estado('Generando el resumen')).toBe('hecho')
    expect(screen.queryByText('Revisión manual')).not.toBeInTheDocument()
  })

  it('sin progreso: todo pendiente', () => {
    render(<EtapasAnalisis progreso={null} />)
    expect(estado('Escaneando el PDF con OCR')).toBe('pendiente')
  })
})
