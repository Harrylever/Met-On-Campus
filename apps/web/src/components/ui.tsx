import type { Intent } from '~/lib/api'

export function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap font-display text-xl font-semibold tracking-tight">
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

export function IntentTabs({ value, onChange, options, counts, alerts }: {
  value: Intent; onChange: (i: Intent) => void
  options: { id: Intent; label: string }[]; counts?: Partial<Record<Intent, number>>
  /** Things waiting on you in each mode (unread chats, unanswered invites). Shown as a filled pill. */
  alerts?: Partial<Record<Intent, number>>
}) {
  const n = options.length
  const index = options.findIndex((o) => o.id === value)
  return (
    <div role="group" className="relative grid rounded-full bg-subtle p-1" style={{ gridTemplateColumns: `repeat(${Math.max(n, 1)}, minmax(0, 1fr))` }}>
      {/* One shared pill slides to the active tab. Its position is derived from props, so the first paint is already
          in place (no slide on load). data-intent gives it the active mode's accent ring. */}
      {index >= 0 && (
        <span aria-hidden data-intent={value}
          className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-surface shadow-sm ring-1 ring-(--i-line) transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
          style={{ width: `calc((100% - 0.5rem) / ${n})`, transform: `translateX(${index * 100}%)` }} />
      )}
      {options.map((o) => (
        <button key={o.id} data-intent={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className="relative z-10 flex h-11 items-center justify-center gap-2 rounded-full text-sm font-medium text-ink-2 transition-colors duration-200 aria-pressed:text-ink motion-reduce:transition-none">
          <i className="size-2 rounded-full bg-(--i)" />{o.label}
          {!!alerts?.[o.id] && <span className="min-w-5 rounded-full bg-(--i-ink) px-1.5 text-center font-mono text-[11px] leading-5 text-white"><span className="sr-only">{alerts[o.id]} waiting, </span><span aria-hidden>{alerts[o.id]}</span></span>}
          {counts?.[o.id] != null && <span className="font-mono text-xs text-ink-3">{counts[o.id]}</span>}
        </button>
      ))}
    </div>
  )
}

export const spotLabel = (s: string) => s
export const formatWhen = (iso: string | Date) =>
  new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
