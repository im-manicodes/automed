import { useState } from 'react'
import { LuTrash2 } from 'react-icons/lu'
import type { Evento } from '../../../lib/api'
import { ESTADO_CLASES, estadoLabel } from '../lib/eventos'
import { formatDia } from '../../../lib/format'
import ConfirmDialog from '../../../components/ConfirmDialog'

interface Props {
  eventos: Evento[]
  /** Elimina el evento; debe lanzar si falla (el padre avisa del error). */
  onRemove: (id: string) => Promise<void>
}

export default function EventosRegistrados({ eventos, onRemove }: Props) {
  const [quitar, setQuitar] = useState<Evento | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <section id="eventos" aria-labelledby="eventos-titulo" className="scroll-mt-4 space-y-3">
      <h3 id="eventos-titulo" className="text-lg font-bold">Eventos registrados</h3>
      {eventos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center text-slate-700">Aún no has añadido eventos de este paciente.</p>
      ) : (
        <ul className="space-y-2">
          {eventos.map((ev) => (
            <li key={ev.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{formatDia(ev.fecha)}</span>
                <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${ESTADO_CLASES[ev.estado] ?? ESTADO_CLASES.otro}`}>{estadoLabel(ev.estado)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words">{ev.novedadTexto || '(Sin descripción)'}</p>
              <details>
                <summary className="min-h-11 cursor-pointer py-2 font-medium">Ver los datos</summary>
                <dl className="space-y-2">
                  {ev.columnas.map((c) => (
                    <div key={c}>
                      <dt className="text-sm font-semibold text-slate-700">{c}</dt>
                      <dd className="whitespace-pre-wrap break-words">{ev.datos[c] || '—'}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              <button type="button" className="btn btn-secondary" onClick={() => setQuitar(ev)}>
                <LuTrash2 className="size-5 shrink-0" aria-hidden />Eliminar
              </button>
            </li>
          ))}
        </ul>
      )}

      {quitar && (
        <ConfirmDialog
          title="¿Quitar este evento del Excel?"
          confirmLabel="Sí, quitar"
          busy={busy}
          onCancel={() => setQuitar(null)}
          onConfirm={() => {
            setBusy(true)
            onRemove(quitar.id)
              .catch(() => undefined)
              .finally(() => {
                setBusy(false)
                setQuitar(null)
              })
          }}
        >
          <p>Se quita de la bitácora de este paciente y del Excel que generes desde ahora.</p>
          <p>Los Excel que ya descargaste no cambian.</p>
        </ConfirmDialog>
      )}
    </section>
  )
}
