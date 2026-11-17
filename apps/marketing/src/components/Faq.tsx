export function Faq({ items }: { items: { q: string; a: React.ReactNode }[] }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((it) => (
        <details key={it.q} className="group py-1">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-6 py-3 font-display text-lg font-semibold [&::-webkit-details-marker]:hidden">
            {it.q}
            <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-ink-2 transition-transform group-open:rotate-45" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </summary>
          <div className="max-w-[62ch] pb-5 text-ink-2 [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-4">{it.a}</div>
        </details>
      ))}
    </div>
  )
}
