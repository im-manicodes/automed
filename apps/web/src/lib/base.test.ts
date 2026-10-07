import { describe, expect, it } from 'vitest'
import { apiUrl, detectBasePath } from './base'

describe('ruta base', () => {
  it('detecta /d/<id> y lo ignora en otras rutas', () => {
    expect(detectBasePath('/d/abc_DEF-123/tickets/5')).toBe('/d/abc_DEF-123')
    expect(detectBasePath('/d/abc')).toBe('/d/abc')
    expect(detectBasePath('/tickets')).toBe('')
    expect(detectBasePath('/dd/abc')).toBe('')
  })
  it('arma la URL de la API con o sin base', () => {
    expect(apiUrl('/threads', '')).toBe('/api/threads')
    expect(apiUrl('/threads', '/d/abc')).toBe('/d/abc/api/threads')
    expect(apiUrl('/threads')).toBe('/api/threads')
  })
})
