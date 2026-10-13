import { useState } from 'react'
import { LuSave } from 'react-icons/lu'
import type { Precios } from '../../../lib/api'
import { CLAVES_OCR, leerPrecio, soloModelosLlm, textoPrecio } from '../lib/uso'

interface Props {
  precios: Precios
  /** Modelos de texto: con uso, sin precio o configurados en Ajustes -> IA. */
  modelos: string[]
  sinPrecio: string[]
  /** Motores OCR usados sin precio por página. */
  ocrSinPrecio?: string[]
  guardando: boolean
  onGuardar: (cambios: Pick<Precios, 'modelos' | 'ocr'>) => void
}

type Borrador = { entrada: string; salida: string; cacheada: string; escrituraCache: string }

function Campo({ id, etiqueta, valor, onChange }: { id: string; etiqueta: string; valor: string; onChange: (v: string) => void }) {
  const invalido = valor.trim() !== '' && leerPrecio(valor) === null
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-slate-700">{etiqueta}</label>
      <input id={id} inputMode="decimal" value={valor} onChange={(e) => onChange(e.target.value)} aria-invalid={invalido} className="min-h-11 w-full rounded-lg border border-slate-300 px-3" />
    </div>
  )
}

export default function EditorPrecios({ precios, modelos, sinPrecio, ocrSinPrecio = [], guardando, onGuardar }: Props) {
  const nombres = soloModelosLlm(Object.keys(precios.modelos), modelos, sinPrecio).sort()
  const [filas, setFilas] = useState<Record<string, Borrador>>(() =>
    Object.fromEntries(nombres.map((m) => {
      const p = precios.modelos[m]
      return [m, { entrada: textoPrecio(p?.entrada), salida: textoPrecio(p?.salida), cacheada: textoPrecio(p?.cacheada), escrituraCache: textoPrecio(p?.escrituraCache) }]
    })),
  )
  const [ocr, setOcr] = useState<Record<string, string>>(() => Object.fromEntries(CLAVES_OCR.map(({ clave }) => [clave, textoPrecio(precios.ocr[clave])])))

  const cambiar = (m: string, k: keyof Borrador, v: string) => setFilas((f) => ({ ...f, [m]: { ...f[m], [k]: v } }))
  const hayInvalido =
    Object.values(filas).some((f) => [f.entrada, f.salida, f.cacheada, f.escrituraCache].some((t) => t.trim() !== '' && leerPrecio(t) === null)) ||
    Object.values(ocr).some((t) => t.trim() !== '' && leerPrecio(t) === null)

  const guardar = () => {
    const modelosOut: Precios['modelos'] = {}
    for (const [m, f] of Object.entries(filas)) {
      const entrada = leerPrecio(f.entrada)
      const salida = leerPrecio(f.salida)
      if (entrada === null && salida === null) continue
      const cacheada = leerPrecio(f.cacheada)
      const escrituraCache = leerPrecio(f.escrituraCache)
      modelosOut[m] = { entrada: entrada ?? 0, salida: salida ?? 0, ...(cacheada !== null ? { cacheada } : {}), ...(escrituraCache !== null ? { escrituraCache } : {}) }
    }
    const ocrOut: Precios['ocr'] = {}
    for (const { clave } of CLAVES_OCR) {
      const v = leerPrecio(ocr[clave] ?? '')
      if (v !== null) ocrOut[clave] = v
    }
    onGuardar({ modelos: modelosOut, ocr: ocrOut })
  }

  return (
    <div className="space-y-4">
      <p className="text-slate-700">Pon el precio en dólares (USD) por millón de tokens, como lo publica tu proveedor. Si el modelo corre en tu equipo (Ollama), pon 0. El costo se recalcula con los precios que guardes. Los campos de caché son opcionales: si los dejas vacíos, esos tokens se cobran al precio de entrada.</p>
      <p className="text-sm text-slate-600">Azure cobra distinto según el tamaño del prompt (short/long context); aquí pon el precio que aplique a tus llamadas.</p>
      {nombres.length === 0 && <p className="text-slate-700">Cuando se use un modelo, aparecerá aquí para ponerle precio.</p>}
      {nombres.map((m, i) => (
        <fieldset key={m} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          <legend className="px-1 font-semibold break-all">{m}</legend>
          {sinPrecio.includes(m) && !(precios.modelos[m]) && <p className="text-sm font-semibold text-amber-800">Sin precio</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <Campo id={`pe-${i}`} etiqueta={`Entrada (Input) · ${m}`} valor={filas[m].entrada} onChange={(v) => cambiar(m, 'entrada', v)} />
            <Campo id={`pc-${i}`} etiqueta={`Entrada en caché (Cached input) · ${m}`} valor={filas[m].cacheada} onChange={(v) => cambiar(m, 'cacheada', v)} />
            <Campo id={`pw-${i}`} etiqueta={`Escritura en caché (Cache writes) · ${m}`} valor={filas[m].escrituraCache} onChange={(v) => cambiar(m, 'escrituraCache', v)} />
            <Campo id={`ps-${i}`} etiqueta={`Salida (Output) · ${m}`} valor={filas[m].salida} onChange={(v) => cambiar(m, 'salida', v)} />
          </div>
        </fieldset>
      ))}
      <fieldset className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <legend className="px-1 font-semibold">OCR de pago: USD por página</legend>
        {ocrSinPrecio.length > 0 && <p role="status" className="text-sm font-semibold text-amber-800">Sin precio por página: {ocrSinPrecio.join(', ')}.</p>}
        <div className="grid gap-2 sm:grid-cols-3">
          {CLAVES_OCR.map(({ clave, etiqueta }) => (
            <Campo key={clave} id={`po-${clave}`} etiqueta={etiqueta} valor={ocr[clave] ?? ''} onChange={(v) => setOcr((o) => ({ ...o, [clave]: v }))} />
          ))}
        </div>
      </fieldset>
      {hayInvalido && <p role="alert" className="text-red-800">Usa solo números de 0 en adelante.</p>}
      <button type="button" className="btn btn-primary w-full" disabled={guardando || hayInvalido} onClick={guardar}>
        <LuSave className="size-5" aria-hidden />{guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}
