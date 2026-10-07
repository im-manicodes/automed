import { useId, useState } from 'react'
import { LuEye, LuEyeOff, LuKeyRound } from 'react-icons/lu'
import type { ClavesAws } from '../../lib/ocr'

interface Props {
  /** ¿El servidor ya tiene claves de AWS guardadas? */
  guardada: boolean
  value: ClavesAws
  onChange: (v: ClavesAws) => void
}

/** Clave de acceso y secreto de AWS. Nunca muestra ni precarga lo guardado. */
export default function CamposAws({ guardada, value, onChange }: Props) {
  const uid = useId()
  const [visible, setVisible] = useState(false)
  const escribiendo = typeof value.accessKeyId === 'string' || typeof value.secreto === 'string'
  const quitando = value.accessKeyId === null || value.secreto === null

  if (guardada && !escribiendo) {
    return (
      <div className="space-y-2">
        <p className="font-semibold">Credenciales de AWS</p>
        {quitando ? (
          <>
            <p className="text-slate-700">Las claves se quitarán al guardar.</p>
            <button type="button" className="btn btn-secondary" onClick={() => onChange({})}>Deshacer</button>
          </>
        ) : (
          <>
            <p className="text-slate-700"><LuKeyRound className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Ya hay una clave guardada</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => onChange({ accessKeyId: '', secreto: '' })}>Reemplazar</button>
              <button type="button" className="btn btn-secondary" onClick={() => onChange({ accessKeyId: null, secreto: null })}>Quitar clave</button>
            </div>
          </>
        )}
      </div>
    )
  }

  const tipo = visible ? 'text' : 'password'
  const clase = 'min-h-12 w-full min-w-0 rounded-xl border border-slate-300 px-3'
  return (
    <div className="space-y-2">
      <label htmlFor={`${uid}-id`} className="block font-semibold">ID de clave de acceso de AWS</label>
      <input id={`${uid}-id`} type={tipo} autoComplete="off" spellCheck={false} className={clase}
        value={typeof value.accessKeyId === 'string' ? value.accessKeyId : ''}
        onChange={(e) => onChange({ ...value, accessKeyId: e.target.value, secreto: typeof value.secreto === 'string' ? value.secreto : '' })} />
      <label htmlFor={`${uid}-secreto`} className="block font-semibold">Clave secreta de AWS</label>
      <div className="flex gap-2">
        <input id={`${uid}-secreto`} type={tipo} autoComplete="off" spellCheck={false} className={clase}
          value={typeof value.secreto === 'string' ? value.secreto : ''}
          onChange={(e) => onChange({ ...value, secreto: e.target.value, accessKeyId: typeof value.accessKeyId === 'string' ? value.accessKeyId : '' })} />
        <button type="button" className="btn btn-secondary shrink-0" aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
          {visible ? <LuEyeOff className="size-5" aria-hidden /> : <LuEye className="size-5" aria-hidden />}
          {visible ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {guardada && (
        <button type="button" className="btn btn-secondary" onClick={() => { setVisible(false); onChange({}) }}>
          Cancelar y conservar la clave guardada
        </button>
      )}
    </div>
  )
}
