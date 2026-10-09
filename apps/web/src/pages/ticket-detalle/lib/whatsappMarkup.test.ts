import { envolverSeleccion, parseWhatsapp } from './whatsappMarkup'

const linea = (t: string) => {
  const b = parseWhatsapp(t)[0]
  return b.tipo === 'linea' ? b.hijos : []
}

describe('parseWhatsapp', () => {
  it('negrita, cursiva y código en línea', () => {
    expect(linea('a *b* _c_ `d`')).toEqual([
      { tipo: 'texto', texto: 'a ' },
      { tipo: 'negrita', hijos: [{ tipo: 'texto', texto: 'b' }] },
      { tipo: 'texto', texto: ' ' },
      { tipo: 'cursiva', hijos: [{ tipo: 'texto', texto: 'c' }] },
      { tipo: 'texto', texto: ' ' },
      { tipo: 'codigo', texto: 'd' },
    ])
  })
  it('la marca debe ir pegada a la palabra', () => {
    expect(linea('* no * y 2 * 3 * 4')).toEqual([{ tipo: 'texto', texto: '* no * y 2 * 3 * 4' }])
    expect(linea('snake_case_name')).toEqual([{ tipo: 'texto', texto: 'snake_case_name' }])
  })
  it('no formatea dentro de código', () => {
    expect(linea('`*x*`')).toEqual([{ tipo: 'codigo', texto: '*x*' }])
  })
  it('bloques de código y viñetas', () => {
    const b = parseWhatsapp('• uno\n```\n*a*\nb\n```\nfin')
    expect(b[0]).toMatchObject({ tipo: 'linea', viñeta: true })
    expect(b[1]).toEqual({ tipo: 'bloque-codigo', texto: '*a*\nb' })
    expect(b[2]).toMatchObject({ tipo: 'linea', viñeta: false })
  })
  it('bloque sin cerrar queda como texto', () => {
    expect(parseWhatsapp('```abc')[0].tipo).toBe('linea')
  })
  it('anida cursiva en negrita', () => {
    expect(linea('*a _b_*')).toEqual([{ tipo: 'negrita', hijos: [{ tipo: 'texto', texto: 'a ' }, { tipo: 'cursiva', hijos: [{ tipo: 'texto', texto: 'b' }] }] }])
  })
})

describe('envolverSeleccion', () => {
  it('envuelve y conserva la selección', () => {
    expect(envolverSeleccion('hola mundo', 5, 10, '*')).toEqual({ texto: 'hola *mundo*', ini: 6, fin: 11 })
  })
  it('sin selección inserta marcas vacías', () => {
    expect(envolverSeleccion('ab', 1, 1, '_')).toEqual({ texto: 'a__b', ini: 2, fin: 2 })
  })
})
