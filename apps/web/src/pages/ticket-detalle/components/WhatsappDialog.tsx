import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LuCopy, LuExternalLink, LuPencil } from 'react-icons/lu'
import { useToast } from '../../../context/toasts-context'
import { copiarTexto } from '../../../lib/clipboard'
import { enlaceWhatsApp } from '../lib/whatsapp'

interface Props {
  /** Texto propuesto por la IA a partir del último correo. */
  initial: string
  onClose: () => void
}

export default function WhatsappDialog({ initial, onClose }: Props) {
  const { toast } = useToast()
  const [texto, setTexto] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const enlace = enlaceWhatsApp(texto)

  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copiar = async () => {
    if (await copiarTexto(texto)) toast('Copiado para WhatsApp. Ya puedes pegarlo.', 'ok')
    else toast('No se pudo copiar. Selecciona el texto y cópialo a mano.', 'error')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="wa-title" className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="wa-title" className="text-xl font-bold">Mensaje para WhatsApp</h2>
        <p className="text-sm text-slate-700">Se redactó usando solo el último correo (y sus adjuntos). Puedes editarlo antes de enviarlo.</p>
        <label htmlFor="wa-texto" className="sr-only">Texto del mensaje</label>
        <textarea id="wa-texto" ref={ref} value={texto} onChange={(e) => setTexto(e.target.value)} rows={10} className="w-full rounded-xl border border-slate-300 p-3 text-base" />
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" className="btn flex-1" onClick={() => void copiar()}><LuCopy className="size-5 shrink-0" aria-hidden />Copiar</button>
          {enlace ? (
            <a className="btn btn-secondary flex-1" href={enlace} target="_blank" rel="noopener noreferrer"><LuExternalLink className="size-5 shrink-0" aria-hidden />Abrir WhatsApp</a>
          ) : (
            <button type="button" className="btn btn-secondary flex-1" disabled aria-describedby="wa-ayuda"><LuExternalLink className="size-5 shrink-0" aria-hidden />Abrir WhatsApp</button>
          )}
          <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>Cerrar</button>
        </div>
        <Link to="/plantilla?tipo=whatsapp" onClick={onClose} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-blue-800 underline">
          <LuPencil className="size-4 shrink-0" aria-hidden />Editar formato del mensaje
        </Link>
        {!enlace && <p id="wa-ayuda" className="text-sm text-slate-700">El mensaje es muy largo para abrirlo directo. Pulsa “Copiar” y pégalo en WhatsApp.</p>}
      </div>
    </div>
  )
}
