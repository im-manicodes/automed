import { useCallback, useEffect, useState } from 'react'
import { LuInfo, LuTriangleAlert } from 'react-icons/lu'
import { useToast } from '../context/toasts-context'
import { templatesApi, type ColumnaReporte, type Template } from '../lib/api'
import { errorMessage, formatDate } from '../lib/format'
import type { PlantillaTipo } from '../lib/plantillas'
import ConfirmDialog from './ConfirmDialog'
import ErrorBox from './ErrorBox'
import Markdown from './Markdown'
import Spinner from './Spinner'

/** Editor genérico de una plantilla de la IA (según su tipo): texto, guardar, restaurar y vista previa. */
export default function PlantillaEditor({ tipo }: { tipo: PlantillaTipo }) {
  const { toast } = useToast()
  const kind = tipo.id
  const [tpl, setTpl] = useState<Template | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [columnas, setColumnas] = useState<ColumnaReporte[] | null>(null)
  const [errorColumnas, setErrorColumnas] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const load = useCallback(async () => {
    try {
      const t = await templatesApi.active(kind)
      setTpl(t)
      setText(t.markdown)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [kind])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- patrón de carga inicial / sincronización con la red o la imagen; no cambia el comportamiento
    void load()
  }, [load])

  if (error) return <ErrorBox message={error} onRetry={() => void load()} />
  if (!tpl) return <Spinner text="Cargando la plantilla…" />

  const changed = text !== tpl.markdown
  const tooLong = text.length > tipo.max
  const hasTitle = /^#{1,3}\s+\S/m.test(text)
  const problem = tooLong
    ? `La plantilla es demasiado larga (máximo ${tipo.max.toLocaleString('es')} letras).`
    : text.trim().length < tipo.min
      ? 'La plantilla es demasiado corta.'
      : tipo.exigeTitulos && !hasTitle
        ? 'Escribe al menos un título de sección, por ejemplo: ## Resumen'
        : null

  const save = async () => {
    setBusy(true)
    try {
      const t = await templatesApi.save(text, kind)
      setTpl(t)
      setText(t.markdown)
      toast('Plantilla guardada.', 'ok')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      const t = await templatesApi.reset(kind)
      setTpl(t)
      setText(t.markdown)
      setPreview(null)
      setColumnas(null)
      setErrorColumnas(null)
      toast('Plantilla restaurada.', 'ok')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
      setConfirmReset(false)
    }
  }

  const makePreview = async () => {
    setPreviewing(true)
    try {
      const r = await templatesApi.preview(text, kind)
      setPreview(r.markdown)
      setColumnas(r.columnas ?? null)
      setErrorColumnas(r.error ?? null)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold">{tipo.titulo}</h3>
      <p className="text-slate-700">{tipo.ayuda}</p>
      <p className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-amber-900">
        <LuInfo className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
        {kind === 'resumen' ? (
          <>
            Cambiar la plantilla <strong>no rehace</strong> los tickets que ya tienen resumen. En cada ticket verás un aviso y podrás regenerarlo si quieres.
          </>
        ) : kind === 'reporte' ? (
          <>
            Esta plantilla se usa <strong>en cada reporte nuevo</strong>. Los reportes que ya generaste no cambian.
          </>
        ) : (
          <>
            Esta plantilla se usa <strong>en cada mensaje nuevo</strong> de WhatsApp. No cambia mensajes que ya copiaste.
          </>
        )}
      </p>

      <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor={`plantilla-texto-${kind}`} className="font-semibold">Texto de la plantilla</label>
            <textarea
              id={`plantilla-texto-${kind}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={18}
              spellCheck={false}
              className="block min-h-72 w-full lg:min-h-[28rem] rounded-xl border border-slate-400 bg-white p-3 font-mono text-sm"
            />
            <div className="flex justify-between text-sm">
              <span className={tooLong ? 'font-semibold text-red-800' : 'text-slate-700'}>{text.length.toLocaleString('es')} / {tipo.max.toLocaleString('es')} letras</span>
              <span className="text-slate-700">Versión {tpl.version} · {formatDate(tpl.updatedAt)}</span>
            </div>
            {problem && changed && <p role="alert" className="text-red-800"><LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />{problem}</p>}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className="btn flex-1" disabled={busy || !changed || !!problem} onClick={() => void save()}>
              {busy ? 'Guardando…' : 'Guardar plantilla'}
            </button>
            <button type="button" className="btn btn-secondary flex-1" disabled={busy} onClick={() => setConfirmReset(true)}>Restaurar la original</button>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h4 className="text-lg font-bold">Vista previa</h4>
          <p className="text-sm text-slate-700">{tipo.textoVistaPrevia}{' '}
            {tipo.usaIA ? 'Usa inteligencia artificial (consume un poco) y puede tardar unos segundos. ' : 'No usa inteligencia artificial ni gasta nada. '}
            Funciona con el texto de arriba, aunque no lo hayas guardado.</p>
          <button type="button" className="btn btn-secondary w-full" disabled={previewing || !!problem} onClick={() => void makePreview()}>
            {previewing ? 'Generando vista previa…' : 'Ver vista previa'}
          </button>
          {kind === 'reporte' && errorColumnas && (
            <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-900" data-testid="error-columnas">
              <LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />{errorColumnas}
            </p>
          )}
          {kind === 'reporte' && !errorColumnas && columnas && (
            <div className="space-y-2">
              <p className="font-semibold">{columnas.length === 1 ? '1 columna' : `${columnas.length} columnas`} en el Excel</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-100">
                    <tr><th className="px-3 py-2">Columna</th><th className="px-3 py-2">Qué busca la IA</th></tr>
                  </thead>
                  <tbody>
                    {columnas.map((c) => (
                      <tr key={c.nombre} className="border-t border-slate-200 align-top">
                        <th scope="row" className="px-3 py-2 font-semibold">{c.nombre}</th>
                        <td className="px-3 py-2 text-slate-700">{c.instruccion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {kind !== 'reporte' && preview && (
            <div className="rounded-lg bg-slate-50 p-3">
              {tipo.vistaPreviaComoMarkdown ? <Markdown>{preview}</Markdown> : <pre className="whitespace-pre-wrap break-words font-sans text-sm" data-testid="vista-previa">{preview}</pre>}
            </div>
          )}
        </div>
      </div>

      {confirmReset && (
        <ConfirmDialog title="¿Restaurar la plantilla original?" confirmLabel="Sí, restaurar" busy={busy} onCancel={() => setConfirmReset(false)} onConfirm={() => void reset()}>
          <p>Se pierden los cambios que hiciste en el texto.{kind === 'resumen' ? ' Tus tickets con resumen no se tocan.' : ''}</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
