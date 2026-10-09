import { useState } from 'react'
import { LuSearch, LuX } from 'react-icons/lu'
import { FILTROS_NIVEL, type FiltroNivel } from '../lib/niveles'

interface Props {
  nivel: FiltroNivel
  q: string
  onNivel: (n: FiltroNivel) => void
  onBuscar: (q: string) => void
}

export default function FiltrosRegistro({ nivel, q, onNivel, onBuscar }: Props) {
  const [texto, setTexto] = useState(q)
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Qué mostrar" className="grid grid-cols-3 gap-2">
        {FILTROS_NIVEL.map((f) => (
          <button
            key={f.valor}
            type="button"
            role="radio"
            aria-checked={nivel === f.valor}
            className={`btn min-h-11 px-2 text-sm ${nivel === f.valor ? '' : 'btn-secondary'}`}
            onClick={() => onNivel(f.valor)}
          >
            {f.etiqueta}
          </button>
        ))}
      </div>
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onBuscar(texto)
        }}
      >
        <label htmlFor="registro-buscar" className="sr-only">Buscar en el registro</label>
        <input
          id="registro-buscar"
          type="search"
          className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 px-3"
          placeholder="Buscar (p. ej. Mail)"
          value={texto}
          maxLength={200}
          onChange={(e) => setTexto(e.target.value)}
        />
        <button type="submit" className="btn btn-secondary min-h-11 shrink-0" aria-label="Buscar">
          <LuSearch className="size-5" aria-hidden />
        </button>
        {q && (
          <button
            type="button"
            className="btn btn-secondary min-h-11 shrink-0"
            aria-label="Quitar búsqueda"
            onClick={() => {
              setTexto('')
              onBuscar('')
            }}
          >
            <LuX className="size-5" aria-hidden />
          </button>
        )}
      </form>
    </div>
  )
}
