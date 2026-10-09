import { LuDownload, LuPause, LuPlay, LuTrash2 } from 'react-icons/lu'

interface Props {
  pausado: boolean
  descargando: boolean
  onPausa: () => void
  onDescargar: () => void
  onLimpiar: () => void
}

export default function AccionesRegistro({ pausado, descargando, onPausa, onDescargar, onLimpiar }: Props) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <button type="button" className="btn btn-secondary" aria-pressed={pausado} onClick={onPausa}>
        {pausado ? <LuPlay className="size-5" aria-hidden /> : <LuPause className="size-5" aria-hidden />}
        {pausado ? 'Reanudar' : 'Pausar'}
      </button>
      <button type="button" className="btn btn-secondary" disabled={descargando} onClick={onDescargar}>
        <LuDownload className="size-5" aria-hidden />
        {descargando ? 'Descargando…' : 'Descargar'}
      </button>
      <button type="button" className="btn btn-secondary" onClick={onLimpiar}>
        <LuTrash2 className="size-5" aria-hidden />
        Limpiar
      </button>
    </div>
  )
}
