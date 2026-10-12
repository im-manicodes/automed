import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ProgresoAnalisis from './ProgresoAnalisis'
import type { ProgresoAnalisis as Progreso } from '../lib/api'

const base: Progreso = { etapa: 'escaneando_ocr', porcentaje: 40, adjuntos: { total: 3, listos: 1 } }

describe('ProgresoAnalisis', () => {
  it('muestra una barra accesible con el PDF actual', () => {
    render(<ProgresoAnalisis progreso={base} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuetext', 'Escaneando el PDF 2 de 3…')
    expect(screen.getByText('Escaneando el PDF 2 de 3…')).toBeInTheDocument()
  })

  it('muestra las páginas leídas', () => {
    render(<ProgresoAnalisis progreso={{ ...base, paginas: { total: 6, leidas: 2 } }} />)
    expect(screen.getByText(/Páginas leídas: 2 de 6/)).toBeInTheDocument()
  })

  it('en cola', () => {
    render(<ProgresoAnalisis progreso={{ etapa: 'en_cola', porcentaje: 5, adjuntos: { total: 0, listos: 0 } }} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'En cola…')
  })

  it('generando el resumen es indeterminada', () => {
    render(<ProgresoAnalisis progreso={{ etapa: 'generando_resumen', porcentaje: 80, adjuntos: { total: 0, listos: 0 } }} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(bar).toHaveAttribute('aria-valuetext', 'Generando el resumen…')
  })

  it('reintento', () => {
    render(<ProgresoAnalisis progreso={{ ...base, reintento: { intento: 2, maximo: 5 } }} />)
    expect(screen.getByText('Reintentando (2 de 5)…')).toBeInTheDocument()
  })

  it('sin datos usa barra indeterminada', () => {
    render(<ProgresoAnalisis progreso={null} compact />)
    const bar = screen.getByRole('progressbar')
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByText('Analizando…')).toBeInTheDocument()
  })

  it.each([
    ['ia_dudosas', 'Pasando a la IA las partes dudosas…'],
    ['procesando_dudosas', 'Procesando las partes dudosas…'],
    ['revision_manual', 'Esperando tu revisión…'],
    ['resumen_listo', 'Resumen generado'],
  ] as const)('etapa %s', (etapa, texto) => {
    render(<ProgresoAnalisis progreso={{ etapa, porcentaje: 50, adjuntos: { total: 1, listos: 1 } }} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', texto)
  })
})
