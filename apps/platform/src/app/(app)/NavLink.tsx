'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function NavLink({ href, label, badge }: { href: string; label: string; badge?: number }) {
  const path = usePathname()
  const active = href === '/' ? path === '/' : path.startsWith(href)
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}
      className={`flex h-10 shrink-0 items-center justify-between gap-3 rounded-lg px-3 text-sm ${active ? 'bg-ink font-semibold text-canvas' : 'text-ink-2 hover:bg-subtle'}`}>
      {label}
      {!!badge && <span className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${active ? 'bg-canvas text-ink' : 'bg-danger text-white'}`} aria-label={`${badge} open`}>{badge}</span>}
    </Link>
  )
}
