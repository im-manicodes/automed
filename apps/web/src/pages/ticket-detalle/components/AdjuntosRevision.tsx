import { useMemo, useState } from 'react'
import type { MessageInfo } from '../../../lib/api'
import ErrorBox from '../../../components/ErrorBox'
import Spinner from '../../../components/Spinner'
import VisorPaginas from './VisorPaginas'
import { useAttachmentPages } from '../hooks/useAttachmentPages'

/** Vista previa de los PDF del ticket. Pide las páginas solo cuando se monta (al abrir la pestaña). */
export default function AdjuntosRevision({ mensajes }: { mensajes: MessageInfo[] }) {
  const docs = useMemo(
    () => mensajes.flatMap((m) => m.attachments.map((a) => ({ id: a.id, nombre: a.filename, origen: m.from, fecha: m.receivedAt }))),
    [mensajes],
  )
  const [elegido, setElegido] = useState(docs[0]?.id ?? '')
  if (docs.length === 0) return <p className="p-4 text-slate-700">Este ticket no tiene PDF.</p>

  const doc = docs.find((d) => d.id === elegido) ?? docs[0]

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="space-y-1">
        <label htmlFor="adjunto-sel" className="block font-semibold">Documento</label>
        <select
          id="adjunto-sel"
          value={doc.id}
          onChange={(e) => setElegido(e.target.value)}
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white p-3 text-base"
        >
          {docs.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </select>
        <p className="text-sm text-slate-700">Del correo de {doc.origen}</p>
      </div>
      <div className="min-h-0 flex-1">
        <PaginasDoc key={doc.id} id={doc.id} />
      </div>
    </div>
  )
}

/** Carga y muestra las páginas de un documento (se remonta al cambiar de documento). */
function PaginasDoc({ id }: { id: string }) {
  const { data, error, refetch } = useAttachmentPages(id)
  if (error) return <ErrorBox message={error} onRetry={() => void refetch()} />
  if (!data) return <Spinner text="Cargando el documento…" />
  const paginas = data.pages.map((p) => p.pageNumber)
  if (paginas.length === 0) return <p className="p-4 text-slate-700">Este documento no tiene vista previa disponible.</p>
  return <VisorPaginas attachmentId={id} paginas={paginas} />
}
