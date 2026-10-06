import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ConectarOutlookButton from '../components/ConectarOutlookButton'
import ErrorBox from '../components/ErrorBox'
import Spinner from '../components/Spinner'
import TicketCard from '../components/TicketCard'
import { useToast } from '../context/toasts-context'
import { ApiError, mailApi, threadsApi, type ProcessStatus, type ThreadListItem } from '../lib/api'
import { errorMessage, plural } from '../lib/format'
import { canAnalyze, FILTERS, isBusy } from '../lib/status'
import { usePolling } from '../lib/usePolling'
import { LuRefreshCw, LuFileSpreadsheet, LuInfo, LuPlug, LuInbox } from 'react-icons/lu'

type Filter = ProcessStatus | undefined

function matches(t: ThreadListItem, f: Filter): boolean {
  if (!f) return true
  if (f === 'procesando') return isBusy(t.status)
  return t.status === f
}

export default function Tickets() {
  const { toast } = useToast()
  const [tickets, setTickets] = useState<ThreadListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [filter, setFilter] = useState<Filter>(undefined)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  const load = useCallback(async (silent = false) => {
    try {
      const list = await threadsApi.list()
      setTickets(list)
      setError(null)
      // quita de la selección lo que ya no se puede analizar
      setSelected((s) => {
        const ok = new Set(list.filter(canAnalyze).map((t) => t.id))
        const next = new Set([...s].filter((id) => ok.has(id)))
        return next.size === s.size ? s : next
      })
    } catch (e) {
      if (!silent) setError(errorMessage(e))
    }
  }, [])

  const loadConnection = useCallback(async () => {
    try {
      setConnected((await mailApi.status()).connected)
    } catch {
      setConnected(null) // si no se sabe, no se bloquea nada
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- patrón de carga inicial / sincronización con la red o la imagen; no cambia el comportamiento
    void loadConnection()
  }, [loadConnection])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- patrón de carga inicial / sincronización con la red o la imagen; no cambia el comportamiento
    void load()
  }, [load])

  usePolling(() => void load(true), 5000, !!tickets?.some((t) => isBusy(t.status)))

  const visible = useMemo(() => (tickets ?? []).filter((t) => matches(t, filter)), [tickets, filter])

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const sync = async () => {
    setSyncing(true)
    try {
      const r = await mailApi.sync()
      if (!r.started) toast('Ya se está sincronizando el correo. Espera un momento.', 'info')
      else if (r.error) toast('No se pudo sincronizar el correo. Intenta de nuevo.', 'error')
      else toast(r.newMessages > 0 ? `Listo: ${plural(r.newMessages, 'correo nuevo', 'correos nuevos')}.` : 'Listo: no hay correos nuevos.', 'ok')
      await load(true)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConnected(false)
        toast('Conecta tu Outlook primero.', 'info')
      } else toast(errorMessage(e), 'error')
    } finally {
      setSyncing(false)
    }
  }

  const analyze = async () => {
    const ids = [...selected]
    setAnalyzing(true)
    try {
      const { results } = await threadsApi.analyzeMany(ids)
      const ok = results.filter((r) => r.ok).length
      const bad = results.filter((r) => !r.ok)
      if (ok) toast(`Analizando ${plural(ok, 'ticket', 'tickets')}. Puedes seguir usando la app.`, 'ok')
      if (bad.length) toast(`${plural(bad.length, 'ticket no se pudo', 'tickets no se pudieron')} analizar: ${bad[0].error ?? 'intenta de nuevo'}`, 'error')
      setSelected(new Set())
      await load(true)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <section className="space-y-4 md:pb-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Tus tickets</h2>
        <div className="flex flex-wrap gap-2">
          <Link to="/reportes?generar=1" className="btn btn-secondary">
            <LuFileSpreadsheet className="size-5" aria-hidden />
            Generar Excel
          </Link>
          <button type="button" className="btn btn-secondary" onClick={() => void sync()} disabled={syncing || connected === false}>
            <LuRefreshCw className={`size-5 ${syncing ? 'animate-spin' : ''}`} aria-hidden />
            {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
        </div>
      </div>

      <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
        <LuInfo className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />
        Analizar usa inteligencia artificial para leer los correos y los PDF y escribir el resumen. Solo se analiza lo que tú elijas.
      </p>

      <div role="group" aria-label="Filtrar por estado" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {FILTERS.map((f) => (
          <button key={f.label} type="button" className="chip shrink-0" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!error && tickets === null && <Spinner text="Cargando tus tickets…" />}
      {connected === false && (
        <div className="space-y-3 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <LuPlug className="mx-auto size-9 text-slate-600" aria-hidden />
          <p className="font-semibold">Conecta tu Outlook para empezar</p>
          <p className="text-slate-700">Aún no hay un correo conectado, por eso no podemos traer tus mensajes. Solo pedimos permiso de lectura.</p>
          <ConectarOutlookButton />
        </div>
      )}
      {tickets && tickets.length === 0 && connected !== false && (
        <div className="space-y-2 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <LuInbox className="mx-auto size-9 text-slate-600" aria-hidden />
          <p className="font-semibold">Todavía no hay tickets</p>
          <p className="text-slate-700">Pulsa “Sincronizar ahora” para traer tus correos.</p>
        </div>
      )}
      {tickets && tickets.length > 0 && visible.length === 0 && (
        <p className="rounded-xl bg-white p-6 text-center text-slate-700">No hay tickets con este estado.</p>
      )}
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {visible.map((t) => (
          <TicketCard key={t.id} ticket={t} selected={selected.has(t.id)} onToggle={toggle} />
        ))}
      </ul>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-30 mx-auto flex max-w-3xl items-center gap-3 border-t border-slate-200 bg-white p-3 shadow-lg md:bottom-0 md:left-48 md:max-w-none lg:left-60">
          <button type="button" className="btn btn-secondary" onClick={() => setSelected(new Set())}>Quitar</button>
          <button type="button" className="btn flex-1" disabled={analyzing || selected.size > 50} onClick={() => void analyze()}>
            {analyzing ? 'Enviando…' : `Analizar ${plural(selected.size, 'ticket', 'tickets')}`}
          </button>
          {selected.size > 50 && <p className="text-sm text-red-800">Máximo 50 a la vez.</p>}
        </div>
      )}
    </section>
  )
}
