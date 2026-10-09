import { useState } from 'react'
import { LuCheck, LuKeyRound, LuTriangleAlert } from 'react-icons/lu'
import type { AjustesAlmacenamiento } from '../../lib/api'
import {
  PROVEEDORES_ALMACENAMIENTO,
  cuerpoAlmacenamiento,
  faltaAlmacenamiento,
  type BorradorAlmacenamiento,
} from '../../lib/almacenamiento'
import { errorMessage } from '../../lib/format'
import { usePruebaAlmacenamiento } from '../../hooks/useAjustesAlmacenamiento'

interface Props {
  ajustes: AjustesAlmacenamiento
  borrador: BorradorAlmacenamiento
  onChange: (b: BorradorAlmacenamiento) => void
  /** Avisa si la última prueba de conexión (con lo escrito ahora) fue correcta. */
  onProbado?: (ok: boolean) => void
}

const campoCls = 'w-full rounded-xl border border-slate-300 bg-white p-3 text-base min-h-11'

function Campo({ id, etiqueta, ayuda, ...rest }: { id: string; etiqueta: string; ayuda?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="font-semibold">{etiqueta}</label>
      <input id={id} autoComplete="off" spellCheck={false} className={campoCls} aria-describedby={ayuda ? `${id}-h` : undefined} {...rest} />
      {ayuda && <p id={`${id}-h`} className="text-sm text-slate-600">{ayuda}</p>}
    </div>
  )
}

/** Elegir RustFS o AWS S3, escribir sus datos y probar la conexión. Compartido por Ajustes y el asistente. */
export default function ConfigAlmacenamiento({ ajustes, borrador, onChange, onProbado }: Props) {
  const prueba = usePruebaAlmacenamiento()
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(null)
  const falta = faltaAlmacenamiento(borrador, ajustes)

  const cambiar = (b: BorradorAlmacenamiento) => {
    if (resultado) {
      setResultado(null)
      onProbado?.(false)
    }
    onChange(b)
  }
  const setR = (k: keyof BorradorAlmacenamiento['rustfs'], v: string) => cambiar({ ...borrador, rustfs: { ...borrador.rustfs, [k]: v } })
  const setS = (k: keyof BorradorAlmacenamiento['s3'], v: string) => cambiar({ ...borrador, s3: { ...borrador.s3, [k]: v } })

  const probar = async () => {
    setResultado(null)
    try {
      const r = await prueba.mutate({ body_params: cuerpoAlmacenamiento(borrador) })
      setResultado(r)
      onProbado?.(r.ok)
    } catch (e) {
      setResultado({ ok: false, mensaje: errorMessage(e) })
      onProbado?.(false)
    }
  }

  const r = borrador.rustfs
  const s = borrador.s3

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Dónde guardar los archivos" className="grid gap-3 md:grid-cols-2">
        {PROVEEDORES_ALMACENAMIENTO.map((p) => {
          const activo = borrador.proveedor === p.id
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={activo}
              onClick={() => cambiar({ ...borrador, proveedor: p.id })}
              className={`min-h-12 rounded-xl border-2 p-4 text-left ${activo ? 'border-blue-700 bg-blue-50' : 'border-slate-200 bg-white'}`}
            >
              <span className="block text-lg font-bold">{p.nombre}</span>
              <span className="block text-slate-700">{p.descripcion}</span>
            </button>
          )
        })}
      </div>

      {borrador.proveedor === 'rustfs' ? (
        <div className="space-y-3">
          <Campo id="alm-endpoint" etiqueta="Dirección del servidor" placeholder="http://mi-servidor:9000" value={r.endpoint} onChange={(e) => setR('endpoint', e.target.value)} />
          <Campo id="alm-bucket" etiqueta="Bucket" value={r.bucket} onChange={(e) => setR('bucket', e.target.value)} />
          <Campo id="alm-access" etiqueta="Clave de acceso" value={r.accessKey} onChange={(e) => setR('accessKey', e.target.value)} />
          <Campo
            id="alm-secret"
            etiqueta="Clave secreta"
            type="password"
            autoComplete="new-password"
            value={r.secretKey}
            placeholder={ajustes.rustfs.tieneSecreto ? 'Guardada: déjalo vacío para conservarla' : ''}
            onChange={(e) => setR('secretKey', e.target.value)}
          />
          {ajustes.rustfs.tieneSecreto && !r.secretKey && (
            <p className="text-sm text-slate-700"><LuKeyRound className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Clave secreta guardada</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <Campo id="alm-region" etiqueta="Región" placeholder="us-east-1" value={s.region} onChange={(e) => setS('region', e.target.value)} />
          <Campo id="alm-s3-bucket" etiqueta="Bucket" value={s.bucket} onChange={(e) => setS('bucket', e.target.value)} />
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            Las claves son opcionales: si las dejas vacías se usa el rol de AWS (IAM) del servidor.
          </p>
          <Campo id="alm-key-id" etiqueta="ID de clave de acceso (opcional)" value={s.accessKeyId} onChange={(e) => setS('accessKeyId', e.target.value)} />
          <Campo
            id="alm-s3-secret"
            etiqueta="Clave secreta de acceso (opcional)"
            type="password"
            autoComplete="new-password"
            value={s.secretAccessKey}
            placeholder={ajustes.s3.tieneSecreto ? 'Guardada: déjalo vacío para conservarla' : ''}
            onChange={(e) => setS('secretAccessKey', e.target.value)}
          />
          {ajustes.s3.tieneSecreto && !s.secretAccessKey && (
            <p className="text-sm text-slate-700"><LuKeyRound className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Clave secreta guardada</p>
          )}
          <Campo id="alm-s3-endpoint" etiqueta="Dirección personalizada (opcional)" placeholder="Solo si usas un S3 compatible" value={s.endpoint} onChange={(e) => setS('endpoint', e.target.value)} />
        </div>
      )}

      <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
        <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />Si cambias de almacenamiento, los archivos ya guardados NO se mueven.
      </p>

      <div className="space-y-2">
        <button type="button" className="btn btn-secondary w-full" disabled={falta !== null || prueba.loading} onClick={() => void probar()}>
          {prueba.loading ? 'Probando…' : 'Probar conexión'}
        </button>
        {falta && <p className="text-sm text-slate-700">{falta}</p>}
        {resultado && (
          <p role={resultado.ok ? 'status' : 'alert'} className={resultado.ok ? 'text-green-900' : 'text-red-900'}>
            {resultado.ok && <LuCheck className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />}
            {resultado.ok ? `Funciona. ${resultado.mensaje}` : resultado.mensaje}
          </p>
        )}
      </div>
    </div>
  )
}
