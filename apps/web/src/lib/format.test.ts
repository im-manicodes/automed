import { formatoAvance, formatoBytes } from './format'

describe('formatoBytes', () => {
  it('usa la unidad adecuada con coma decimal', () => {
    expect(formatoBytes(0)).toBe('0 B')
    expect(formatoBytes(512)).toBe('512 B')
    expect(formatoBytes(2048)).toBe('2 KB')
    expect(formatoBytes(5.5 * 1024 ** 2)).toBe('5,5 MB')
    expect(formatoBytes(3.3 * 1024 ** 3)).toBe('3,3 GB')
  })
  it('tolera valores inválidos', () => {
    expect(formatoBytes(Number.NaN)).toBe('0 B')
    expect(formatoBytes(-5)).toBe('0 B')
  })
})

describe('formatoAvance', () => {
  it('muestra completado de total con porcentaje', () => {
    expect(formatoAvance(1.2 * 1024 ** 3, 3.3 * 1024 ** 3)).toBe('1,2 de 3,3 GB · 36 %')
  })
  it('sin total no muestra nada', () => {
    expect(formatoAvance(10, 0)).toBe('')
  })
})
