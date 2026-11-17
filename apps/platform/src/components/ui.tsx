export function Brand({ small = false, mark = false }: { small?: boolean; mark?: boolean }) {
  // `mark` is the circles only, for the collapsed sidebar.
  if (mark) return <span aria-hidden className="inline-flex"><i className="size-3.5 rounded-full border-2 border-surface bg-[#2563EB]" /><i className="-ml-1.5 size-3.5 rounded-full border-2 border-surface bg-[#059669]" /><i className="-ml-1.5 size-3.5 rounded-full border-2 border-surface bg-[#E11D48]" /></span>
  return (
    <span className={`inline-flex items-center gap-2.5 font-display font-semibold ${small ? 'text-base' : 'text-xl'}`}>
      <span aria-hidden className="inline-flex">
        <i className="size-3.5 rounded-full border-2 border-canvas bg-[#2563EB]" />
        <i className="-ml-1.5 size-3.5 rounded-full border-2 border-canvas bg-[#059669]" />
        <i className="-ml-1.5 size-3.5 rounded-full border-2 border-canvas bg-[#E11D48]" />
      </span>
      Met On Campus <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-2">Platform</span>
    </span>
  )
}

export function AuthShell({ title, children, hint }: { title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <Brand />
      <div className="card space-y-5 p-6">
        <h1 className="text-2xl font-bold">{title}</h1>
        {children}
      </div>
      {hint && <p className="text-xs text-ink-2">{hint}</p>}
    </main>
  )
}
