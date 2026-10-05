import { useState } from 'react'
import { mailApi } from '../lib/api'
import { errorMessage } from '../lib/format'

/** Pide a la API la dirección de Microsoft y navega a ella. */
export default function ConectarOutlookButton({ label = 'Conectar con Outlook', secondary = false, className = '' }: { label?: string; secondary?: boolean; className?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      const { url } = await mailApi.connect()
      window.location.assign(url)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <div className={`space-y-2 ${className}`}>
      <button type="button" className={`btn w-full text-lg ${secondary ? 'btn-secondary' : ''}`} disabled={busy} onClick={() => void go()}>
        {busy ? 'Abriendo Microsoft…' : label}
      </button>
      <div aria-live="assertive">{error && <p role="alert" className="text-red-900"><span aria-hidden>⚠ </span>{error}</p>}</div>
    </div>
  )
}
