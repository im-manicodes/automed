export default function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-xl border border-red-300 bg-red-50 p-4 text-red-900">
      <p><span aria-hidden>⚠ </span>{message}</p>
      {onRetry && <button type="button" className="btn btn-secondary" onClick={onRetry}>Intentar de nuevo</button>}
    </div>
  )
}
