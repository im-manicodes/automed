import { useState } from 'react'
import { LuEye, LuEyeOff, LuKeyRound } from 'react-icons/lu'

interface Props {
  label: string
  /** ¿El servidor ya tiene una clave guardada? */
  guardada: boolean
  /** undefined = sin cambios, string = clave nueva, null = quitar la guardada. */
  value: string | null | undefined
  onChange: (v: string | null | undefined) => void
}

/** Campo de clave de API. Nunca muestra ni precarga la clave guardada. */
export default function CampoClave({ label, guardada, value, onChange }: Props) {
  const [visible, setVisible] = useState(false)
  const [reemplazando, setReemplazando] = useState(false)
  const mostrarInput = !guardada || reemplazando
  const id = `clave-${label.replace(/\W+/g, '-').toLowerCase()}`

  if (!mostrarInput) {
    return (
      <div className="space-y-2">
        <p className="font-semibold">{label}</p>
        {value === null ? (
          <>
            <p className="text-slate-700">La clave se quitará al guardar.</p>
            <button type="button" className="btn btn-secondary" onClick={() => onChange(undefined)}>Deshacer</button>
          </>
        ) : (
          <>
            <p className="text-slate-700"><LuKeyRound className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Ya hay una clave guardada</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => { setReemplazando(true); onChange('') }}>Reemplazar</button>
              <button type="button" className="btn btn-secondary" onClick={() => onChange(null)}>Quitar clave</button>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block font-semibold">{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          className="min-h-12 w-full rounded-xl border border-slate-300 px-3"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="btn btn-secondary" aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
          {visible ? <LuEyeOff className="size-5" aria-hidden /> : <LuEye className="size-5" aria-hidden />}
          {visible ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {guardada && (
        <button type="button" className="btn btn-secondary" onClick={() => { setReemplazando(false); setVisible(false); onChange(undefined) }}>
          Cancelar y conservar la clave guardada
        </button>
      )}
    </div>
  )
}
