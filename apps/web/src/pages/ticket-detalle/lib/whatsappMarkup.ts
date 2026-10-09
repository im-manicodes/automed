import { createElement, Fragment, type ReactNode } from 'react'

/** Fragmento en línea: texto plano o con formato al estilo WhatsApp. */
export type Inline =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'negrita' | 'cursiva'; hijos: Inline[] }
  | { tipo: 'codigo'; texto: string }

/** Bloque: línea normal, viñeta ('• ') o bloque de código (```). */
export type Bloque =
  | { tipo: 'linea'; viñeta: boolean; hijos: Inline[] }
  | { tipo: 'bloque-codigo'; texto: string }

const MARCAS: Record<string, 'negrita' | 'cursiva' | 'codigo'> = { '*': 'negrita', _: 'cursiva', '`': 'codigo' }
const esPalabra = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c)
const esEspacio = (c: string | undefined) => !c || /\s/.test(c)

/** Una marca abre si va tras inicio/no-letra y pegada a la palabra; cierra si va tras no-espacio y antes de no-letra. */
function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const volcar = () => {
    if (buf) out.push({ tipo: 'texto', texto: buf })
    buf = ''
  }
  let i = 0
  while (i < s.length) {
    const c = s[i]
    const tipo = MARCAS[c]
    if (tipo && !esPalabra(s[i - 1]) && !esEspacio(s[i + 1])) {
      let fin = -1
      for (let j = i + 2; j <= s.length - 1 || j === s.length; j++) {
        if (s[j] === c && !esEspacio(s[j - 1]) && !esPalabra(s[j + 1])) {
          fin = j
          break
        }
      }
      if (fin > i + 1) {
        volcar()
        const dentro = s.slice(i + 1, fin)
        out.push(tipo === 'codigo' ? { tipo, texto: dentro } : { tipo, hijos: parseInline(dentro) })
        i = fin + 1
        continue
      }
    }
    buf += c
    i++
  }
  volcar()
  return out
}

/** Convierte el texto con marcas de WhatsApp en bloques/inlines (datos puros). */
export function parseWhatsapp(texto: string): Bloque[] {
  const bloques: Bloque[] = []
  const lineas = texto.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  while (i < lineas.length) {
    if (lineas[i].trim().startsWith('```')) {
      const resto = lineas[i].trim().slice(3)
      const cierreMisma = resto.indexOf('```')
      if (cierreMisma >= 0) {
        bloques.push({ tipo: 'bloque-codigo', texto: resto.slice(0, cierreMisma) })
        i++
        continue
      }
      const cuerpo: string[] = resto ? [resto] : []
      let j = i + 1
      let cerrado = false
      for (; j < lineas.length; j++) {
        const t = lineas[j]
        const k = t.indexOf('```')
        if (k >= 0) {
          if (t.slice(0, k)) cuerpo.push(t.slice(0, k))
          cerrado = true
          break
        }
        cuerpo.push(t)
      }
      if (cerrado) {
        bloques.push({ tipo: 'bloque-codigo', texto: cuerpo.join('\n') })
        i = j + 1
        continue
      }
    }
    const l = lineas[i]
    const viñeta = l.startsWith('• ')
    bloques.push({ tipo: 'linea', viñeta, hijos: parseInline(viñeta ? l.slice(2) : l) })
    i++
  }
  return bloques
}

function renderInline(nodos: Inline[]): ReactNode[] {
  return nodos.map((n, k) => {
    if (n.tipo === 'texto') return createElement(Fragment, { key: k }, n.texto)
    if (n.tipo === 'codigo') return createElement('code', { key: k, className: 'rounded bg-black/5 px-1 font-mono text-[0.9em]' }, n.texto)
    return createElement(n.tipo === 'negrita' ? 'strong' : 'em', { key: k }, ...renderInline(n.hijos))
  })
}

/** Nodos React seguros (sin HTML crudo) para la vista previa. */
export function renderWhatsapp(texto: string): ReactNode[] {
  return parseWhatsapp(texto).map((b, k) => {
    if (b.tipo === 'bloque-codigo') {
      return createElement('pre', { key: k, className: 'my-1 whitespace-pre-wrap rounded bg-black/5 p-2 font-mono text-sm' }, b.texto)
    }
    if (b.hijos.length === 0) return createElement('div', { key: k, className: 'h-4' })
    const hijos = renderInline(b.hijos)
    return createElement('div', { key: k, className: b.viñeta ? 'flex gap-2' : undefined },
      ...(b.viñeta ? [createElement('span', { key: 'v', 'aria-hidden': true }, '•'), createElement('span', { key: 't' }, ...hijos)] : hijos))
  })
}

/** Envuelve la selección con una marca (o inserta marcas vacías si no hay selección). */
export function envolverSeleccion(texto: string, ini: number, fin: number, marca: string) {
  const sel = texto.slice(ini, fin)
  const nuevo = texto.slice(0, ini) + marca + sel + marca + texto.slice(fin)
  return { texto: nuevo, ini: ini + marca.length, fin: ini + marca.length + sel.length }
}
