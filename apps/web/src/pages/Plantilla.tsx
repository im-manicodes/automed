import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'
import ErrorBox from '../components/ErrorBox'
import Markdown from '../components/Markdown'
import Spinner from '../components/Spinner'
import { useToast } from '../context/toasts-context'
import { templatesApi, type Template } from '../lib/api'
import { errorMessage, formatDate } from '../lib/format'

const MAX = 20000

export default function Plantilla() {
  const { toast } = useToast()
  const [tpl, setTpl] = useState<Template | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const load = useCallback(async () => {
    try {
      const t = await templatesApi.active()
      setTpl(t)
      setText(t.markdown)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- patrón de carga inicial / sincronización con la red o la imagen; no cambia el comportamiento
    void load()
  }, [load])

  if (error) return <ErrorBox message={error} onRetry={() => void load()} />
  if (!tpl) return <Spinner text="Cargando la plantilla…" />

  const changed = text !== tpl.markdown
  const tooLong = text.length > MAX
  const hasTitle = /^#{1,3}\s+\S/m.test(text)
  const problem = tooLong
    ? `La plantilla es demasiado larga (máximo ${MAX.toLocaleString('es')} letras).`
    : text.trim().length < 20
      ? 'La plantilla es demasiado corta.'
      : !hasTitle
        ? 'Escribe al menos un título de sección, por ejemplo: ## Resumen'
        : null

  const save = async () => {
    setBusy(true)
    try {
      const t = await templatesApi.save(text)
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
      const t = await templatesApi.reset()
      setTpl(t)
      setText(t.markdown)
      setPreview(null)
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
      setPreview((await templatesApi.preview(text)).markdown)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-bold">Plantilla del resumen</h2>
      <p className="text-slate-700">
        Aquí decides cómo se escribe el resumen de cada ticket. Cada título (## Título) es una sección; lo que va entre{' '}
        <code>{'<!-- -->'}</code> son instrucciones para la inteligencia artificial.
      </p>
      <p className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-amber-900">
        <span aria-hidden>ℹ </span>Cambiar la plantilla <strong>no rehace</strong> los tickets que ya tienen resumen. En cada ticket verás un aviso y podrás regenerarlo si quieres.
      </p>

      <div className="space-y-1">
        <label htmlFor="plantilla-texto" className="font-semibold">Texto de la plantilla</label>
        <textarea
          id="plantilla-texto"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={18}
          spellCheck={false}
          className="block min-h-72 w-full rounded-xl border border-slate-400 bg-white p-3 font-mono text-sm"
        />
        <div className="flex justify-between text-sm">
          <span className={tooLong ? 'font-semibold text-red-800' : 'text-slate-700'}>{text.length.toLocaleString('es')} / {MAX.toLocaleString('es')} letras</span>
          <span className="text-slate-700">Versión {tpl.version} · {formatDate(tpl.updatedAt)}</span>
        </div>
        {problem && changed && <p role="alert" className="text-red-800"><span aria-hidden>⚠ </span>{problem}</p>}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn flex-1" disabled={busy || !changed || !!problem} onClick={() => void save()}>
          {busy ? 'Guardando…' : 'Guardar plantilla'}
        </button>
        <button type="button" className="btn btn-secondary flex-1" disabled={busy} onClick={() => setConfirmReset(true)}>Restaurar la original</button>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-lg font-bold">Vista previa</h3>
        <p className="text-sm text-slate-700">Muestra cómo quedaría con un ticket de ejemplo. Usa inteligencia artificial (consume un poco) y puede tardar unos segundos. Funciona con el texto de arriba, aunque no lo hayas guardado.</p>
        <button type="button" className="btn btn-secondary w-full" disabled={previewing || !!problem} onClick={() => void makePreview()}>
          {previewing ? 'Generando vista previa…' : 'Ver vista previa'}
        </button>
        {preview && <div className="rounded-lg bg-slate-50 p-3"><Markdown>{preview}</Markdown></div>}
      </div>

      {confirmReset && (
        <ConfirmDialog title="¿Restaurar la plantilla original?" confirmLabel="Sí, restaurar" busy={busy} onCancel={() => setConfirmReset(false)} onConfirm={() => void reset()}>
          <p>Se pierden los cambios que hiciste en el texto. Tus tickets con resumen no se tocan.</p>
        </ConfirmDialog>
      )}
    </section>
  )
}
