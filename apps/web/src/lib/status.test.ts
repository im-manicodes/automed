import { canAnalyze, isBusy, statusLabel } from './status'

describe('estados', () => {
  it('mapea estados a etiquetas sencillas', () => {
    expect(statusLabel('sin_analizar')).toBe('Sin analizar')
    expect(statusLabel('pendiente')).toBe('Analizando…')
    expect(statusLabel('procesando')).toBe('Analizando…')
    expect(statusLabel('listo')).toBe('Listo')
    expect(statusLabel('necesita_revision')).toBe('Necesita tu ayuda')
    expect(statusLabel('error')).toBe('Error')
  })
  it('detecta tickets en marcha', () => {
    expect(isBusy('pendiente')).toBe(true)
    expect(isBusy('procesando')).toBe(true)
    expect(isBusy('listo')).toBe(false)
  })
  it('decide cuándo se puede analizar', () => {
    expect(canAnalyze({ status: 'sin_analizar', tieneMensajesNuevos: false })).toBe(true)
    expect(canAnalyze({ status: 'error', tieneMensajesNuevos: false })).toBe(true)
    expect(canAnalyze({ status: 'listo', tieneMensajesNuevos: false })).toBe(false)
    expect(canAnalyze({ status: 'listo', tieneMensajesNuevos: true })).toBe(true)
    expect(canAnalyze({ status: 'procesando', tieneMensajesNuevos: true })).toBe(false)
  })
})
