export default function Spinner({ text, full }: { text: string; full?: boolean }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-3 p-6 text-slate-700 ${full ? 'min-h-dvh' : ''}`}>
      <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
      <span>{text}</span>
    </div>
  )
}
