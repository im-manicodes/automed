import { enlaceWhatsApp } from './whatsapp'

describe('enlaceWhatsApp', () => {
  it('arma wa.me con el texto codificado y rechaza textos largos', () => {
    expect(enlaceWhatsApp('hola mundo')).toBe('https://wa.me/?text=hola%20mundo')
    expect(enlaceWhatsApp('a'.repeat(3000))).toBeNull()
  })
})
