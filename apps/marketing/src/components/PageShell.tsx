export function PageShell({ title, lede, updated, children }: { title: string; lede?: string; updated?: string; children: React.ReactNode }) {
  return (
    <article className="container-x py-14 md:py-20">
      <header className="max-w-3xl">
        <h1 className="text-[clamp(2.4rem,5.5vw,4rem)] tracking-[-0.03em]">{title}</h1>
        {lede && <p className="mt-5 max-w-[56ch] text-lg text-ink-2 sm:text-xl">{lede}</p>}
        {updated && <p className="mt-4 text-sm text-ink-3">Last updated {updated}</p>}
      </header>
      <div className="prose-site mt-12">{children}</div>
    </article>
  )
}
