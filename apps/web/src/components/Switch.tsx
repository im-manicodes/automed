interface Props {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}

export default function Switch({ checked, onChange, label, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center justify-between gap-3 text-left"
    >
      <span className="font-semibold">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-sm font-semibold">{checked ? 'Activado' : 'Apagado'}</span>
        <span aria-hidden className={`flex h-8 w-14 items-center rounded-full p-1 transition ${checked ? 'bg-green-700' : 'bg-slate-400'}`}>
          <span className={`h-6 w-6 rounded-full bg-white transition ${checked ? 'translate-x-6' : ''}`} />
        </span>
      </span>
    </button>
  )
}
