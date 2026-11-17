import type { Intent } from '~/lib/api'

export function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5 font-display text-xl font-semibold tracking-tight">
      <span aria-hidden className="inline-flex">
        <i className="size-4 rounded-full border-2 border-canvas bg-study" />
        <i className="-ml-1.5 size-4 rounded-full border-2 border-canvas bg-friends" />
        <i className="-ml-1.5 size-4 rounded-full border-2 border-canvas bg-romance" />
      </span>
      Met On Campus
    </span>
  )
}

export function VerifiedPill({ campus }: { campus: string }) {
  return (
    <span className="pill text-verified">
      <svg viewBox="0 0 12 12" className="size-3" aria-hidden><circle cx="6" cy="6" r="6" fill="currentColor" /><path d="M3.5 6.2l1.7 1.7 3.3-3.6" stroke="#fff" fill="none" strokeWidth="1.4" /></svg>
      <span className="text-ink">{campus.toUpperCase()} • Verified</span>
    </span>
  )
}

export function IntentTabs({ value, onChange, options, counts }: {
  value: Intent; onChange: (i: Intent) => void
  options: { id: Intent; label: string }[]; counts?: Partial<Record<Intent, number>>
}) {
  return (
    <div role="group" className="flex rounded-full bg-subtle p-1">
      {options.map((o) => (
        <button key={o.id} data-intent={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-sm font-medium text-ink-2 aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-sm">
          <i className="size-2 rounded-full bg-(--i)" />{o.label}
          {counts?.[o.id] != null && <span className="font-mono text-xs text-ink-3">{counts[o.id]}</span>}
        </button>
      ))}
    </div>
  )
}

export const spotLabel = (s: string) => s
export const formatWhen = (iso: string | Date) =>
  new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
