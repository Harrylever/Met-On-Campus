// Three rings: the app's mark. Decorative; the wordmark carries the name.
export function Mark({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 36" fill="none" aria-hidden="true" className={className}>
      <circle cx="18" cy="18" r="13" stroke="var(--study)" strokeWidth="5.5" />
      <circle cx="32" cy="18" r="13" stroke="var(--friends)" strokeWidth="5.5" />
      <circle cx="46" cy="18" r="13" stroke="var(--romance)" strokeWidth="5.5" />
    </svg>
  )
}
// A little smaller on phones so the header (logo, button, menu) fits one line down to 380px.
export function Brand() {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap font-display text-lg font-bold tracking-tight min-[432px]:gap-2.5 min-[432px]:text-xl">
      <Mark className="h-5 w-auto min-[432px]:h-6" />Met On Campus
    </span>
  )
}
