import { LuTriangleAlert } from 'react-icons/lu'

export default function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-xl border border-red-300 bg-red-50 p-4 text-red-900">
      <p className="flex items-start gap-2"><LuTriangleAlert className="size-5 shrink-0" aria-hidden /><span>{message}</span></p>
      {onRetry && <button type="button" className="btn btn-secondary" onClick={onRetry}>Intentar de nuevo</button>}
    </div>
  )
}
