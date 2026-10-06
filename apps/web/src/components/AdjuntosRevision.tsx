import { useEffect, useMemo, useState } from 'react'
import { attachmentsApi, type AttachmentPages, type MessageInfo } from '../lib/api'
import { errorMessage } from '../lib/format'
import ErrorBox from './ErrorBox'
import Spinner from './Spinner'
import VisorPaginas from './VisorPaginas'

type Carga = { id: string; datos: AttachmentPages | null; error: string | null }

/** Vista previa de los PDF del ticket. Pide las páginas solo cuando se monta (al abrir la pestaña). */
export default function AdjuntosRevision({ mensajes }: { mensajes: MessageInfo[] }) {
  const docs = useMemo(
    () => mensajes.flatMap((m) => m.attachments.map((a) => ({ id: a.id, nombre: a.filename, origen: m.from, fecha: m.receivedAt }))),
    [mensajes],
  )
  const [elegido, setElegido] = useState(docs[0]?.id ?? '')
  const [carga, setCarga] = useState<Carga | null>(null)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    if (!elegido) return
    let cancelado = false
    attachmentsApi
      .pages(elegido)
      .then((datos) => !cancelado && setCarga({ id: elegido, datos, error: null }))
      .catch((e: unknown) => !cancelado && setCarga({ id: elegido, datos: null, error: errorMessage(e) }))
    return () => {
      cancelado = true
    }
  }, [elegido, intento])

  if (docs.length === 0) return <p className="p-4 text-slate-700">Este ticket no tiene PDF.</p>

  const doc = docs.find((d) => d.id === elegido) ?? docs[0]
  const actual = carga?.id === doc.id ? carga : null
  const paginas = actual?.datos?.pages.map((p) => p.pageNumber) ?? []

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="space-y-1">
        <label htmlFor="adjunto-sel" className="block font-semibold">Documento</label>
        <select
          id="adjunto-sel"
          value={doc.id}
          onChange={(e) => {
            setCarga(null)
            setElegido(e.target.value)
          }}
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white p-3 text-base"
        >
          {docs.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </select>
        <p className="text-sm text-slate-700">Del correo de {doc.origen}</p>
      </div>
      <div className="min-h-0 flex-1">
        {!actual && <Spinner text="Cargando el documento…" />}
        {actual?.error && (
          <ErrorBox
            message={actual.error}
            onRetry={() => {
              setCarga(null)
              setIntento((n) => n + 1)
            }}
          />
        )}
        {actual?.datos && paginas.length === 0 && <p className="p-4 text-slate-700">Este documento no tiene vista previa disponible.</p>}
        {actual?.datos && paginas.length > 0 && <VisorPaginas attachmentId={doc.id} paginas={paginas} />}
      </div>
    </div>
  )
}
