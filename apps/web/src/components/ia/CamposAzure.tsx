import { useId, useState } from 'react'
import { LuEye, LuEyeOff, LuKeyRound } from 'react-icons/lu'
import type { ClavesAzure } from '../../lib/ocr'

interface Props {
  /** Dirección guardada en el servidor. */
  endpointGuardado: string
  /** ¿El servidor ya tiene una clave de Azure guardada? */
  claveGuardada: boolean
  value: ClavesAzure
  onChange: (v: ClavesAzure) => void
}

const CLASE = 'min-h-12 w-full min-w-0 rounded-xl border border-slate-300 px-3'

/** Dirección del recurso y clave de Azure Document Intelligence. Nunca muestra ni precarga la clave. */
export default function CamposAzure({ endpointGuardado, claveGuardada, value, onChange }: Props) {
  const uid = useId()
  const [visible, setVisible] = useState(false)
  const escribiendo = typeof value.clave === 'string'
  const quitando = value.clave === null

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label htmlFor={`${uid}-endpoint`} className="block font-semibold">Dirección del recurso de Azure</label>
        <input id={`${uid}-endpoint`} type="url" inputMode="url" autoComplete="off" spellCheck={false} className={CLASE}
          placeholder="https://mi-recurso.cognitiveservices.azure.com"
          value={value.endpoint ?? endpointGuardado}
          onChange={(e) => onChange({ ...value, endpoint: e.target.value })} />
        <p className="text-sm text-slate-700">La encuentras en el portal de Azure, en «Claves y punto de conexión» de tu recurso de Document Intelligence.</p>
      </div>

      {claveGuardada && !escribiendo ? (
        <div className="space-y-2">
          <p className="font-semibold">Clave de Azure</p>
          {quitando ? (
            <>
              <p className="text-slate-700">La clave se quitará al guardar.</p>
              <button type="button" className="btn btn-secondary" onClick={() => onChange({ ...value, clave: undefined })}>Deshacer</button>
            </>
          ) : (
            <>
              <p className="text-slate-700"><LuKeyRound className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Ya hay una clave guardada</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary" onClick={() => onChange({ ...value, clave: '' })}>Reemplazar</button>
                <button type="button" className="btn btn-secondary" onClick={() => onChange({ ...value, clave: null })}>Quitar clave</button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor={`${uid}-clave`} className="block font-semibold">Clave de Azure</label>
          <div className="flex gap-2">
            <input id={`${uid}-clave`} type={visible ? 'text' : 'password'} autoComplete="off" spellCheck={false} className={CLASE}
              value={typeof value.clave === 'string' ? value.clave : ''}
              onChange={(e) => onChange({ ...value, clave: e.target.value })} />
            <button type="button" className="btn btn-secondary shrink-0" aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
              {visible ? <LuEyeOff className="size-5" aria-hidden /> : <LuEye className="size-5" aria-hidden />}
              {visible ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          {claveGuardada && (
            <button type="button" className="btn btn-secondary" onClick={() => { setVisible(false); onChange({ ...value, clave: undefined }) }}>
              Cancelar y conservar la clave guardada
            </button>
          )}
        </div>
      )}
    </div>
  )
}
