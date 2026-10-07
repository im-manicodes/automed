import { useState } from 'react'
import { useConnectOutlook } from '../hooks/useMail'
import { errorMessage } from '../lib/format'
import { LuTriangleAlert } from 'react-icons/lu'

/** Pide a la API la dirección de Microsoft y navega a ella. */
export default function ConectarOutlookButton({ label = 'Conectar con Outlook', secondary = false, className = '', disabled = false }: { label?: string; secondary?: boolean; className?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { mutate: connect } = useConnectOutlook()
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      const { url } = await connect()
      window.location.assign(url)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <div className={`space-y-2 ${className}`}>
      <button type="button" className={`btn w-full text-lg ${secondary ? 'btn-secondary' : ''}`} disabled={busy || disabled} onClick={() => void go()}>
        {busy ? 'Abriendo Microsoft…' : label}
      </button>
      <div aria-live="assertive">{error && <p role="alert" className="text-red-900"><LuTriangleAlert className="mr-1.5 -mt-0.5 inline size-4" aria-hidden />{error}</p>}</div>
    </div>
  )
}
