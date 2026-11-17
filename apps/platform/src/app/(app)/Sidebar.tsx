'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Icon, type IconName } from '~/components/icons'

export type NavItem = { href: string; label: string; icon: IconName; badge?: number }
const COOKIE = 'moc_sidebar'

/**
 * Full-height, collapsible sidebar on desktop (a top bar on phones). The collapsed state lives in a plain
 * cookie so the server can render the right width on the first paint. It holds no sensitive data.
 */
export function Sidebar({ items, email, initialCollapsed, signOut, brand, brandMark }: {
  items: NavItem[]; email: string; initialCollapsed: boolean; signOut: () => Promise<void>
  brand: React.ReactNode; brandMark: React.ReactNode
}) {
  const path = usePathname()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    document.cookie = `${COOKIE}=${next ? '1' : '0'}; path=/; max-age=31536000; samesite=strict${location.protocol === 'https:' ? '; secure' : ''}`
  }

  return (
    <aside className={`flex shrink-0 flex-col gap-3 border-b border-line bg-surface p-3 transition-[width] duration-200 motion-reduce:transition-none md:sticky md:top-0 md:h-dvh md:border-b-0 md:border-r ${collapsed ? 'md:w-[68px]' : 'md:w-60'}`}>
      <div className={`flex items-center ${collapsed ? 'md:justify-center' : 'justify-between'} gap-2 px-1`}>
        <Link href="/" aria-label="Overview" className="min-w-0">
          <span className={collapsed ? 'md:hidden' : ''}>{brand}</span>
          <span className={collapsed ? 'hidden md:inline-flex' : 'hidden'}>{brandMark}</span>
        </Link>
        {/* Rendered only when expanded: toggling visibility with two conflicting responsive classes left it showing. */}
        {!collapsed && (
          <button type="button" onClick={toggle} aria-expanded aria-controls="sidebar-nav" aria-label="Collapse sidebar" title="Collapse sidebar"
            className="hidden size-9 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-subtle hover:text-ink md:inline-flex">
            <Icon name="collapse" />
          </button>
        )}
      </div>
      {collapsed && (
        <button type="button" onClick={toggle} aria-expanded={false} aria-controls="sidebar-nav" aria-label="Expand sidebar" title="Expand sidebar"
          className="hidden size-10 items-center justify-center self-center rounded-lg text-ink-2 hover:bg-subtle hover:text-ink md:inline-flex">
          <Icon name="expand" />
        </button>
      )}

      <nav id="sidebar-nav" aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-1 md:flex-col md:overflow-y-auto md:overflow-x-hidden">
        {items.map((n) => {
          const active = n.href === '/' ? path === '/' : path.startsWith(n.href)
          return (
            <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} title={collapsed ? n.label : undefined}
              className={`relative flex h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm ${collapsed ? 'md:justify-center md:px-0' : ''} ${active ? 'bg-ink font-semibold text-canvas' : 'text-ink-2 hover:bg-subtle hover:text-ink'}`}>
              <Icon name={n.icon} />
              <span className={collapsed ? 'md:sr-only' : ''}>{n.label}</span>
              {!!n.badge && (
                <span aria-label={`${n.badge} open`}
                  className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${active ? 'bg-canvas text-ink' : 'bg-danger text-white'} ${collapsed ? 'md:absolute md:right-1 md:top-1 md:min-w-4 md:px-1 md:text-[10px] md:leading-4' : 'ml-auto'}`}>
                  {n.badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="hidden space-y-2 border-t border-line pt-3 md:block">
        {!collapsed && <p className="break-all px-1 text-xs text-ink-2" title={email}>{email}</p>}
        <form action={signOut}>
          <button title="Sign out" aria-label={collapsed ? `Sign out (${email})` : 'Sign out'}
            className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-ink-2 hover:bg-subtle hover:text-ink ${collapsed ? 'justify-center px-0' : ''}`}>
            <Icon name="signout" /><span className={collapsed ? 'sr-only' : ''}>Sign out</span>
          </button>
        </form>
      </div>
    </aside>
  )
}
