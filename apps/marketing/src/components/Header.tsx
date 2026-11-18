import Link from 'next/link'
import { Brand } from './Brand'
import { MobileMenu } from './MobileMenu'
import { ThemeToggle } from './ThemeToggle'
import { site } from '~/lib/site'

const links = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/safety', label: 'Safety' },
  { href: '/universities', label: 'For universities' },
]

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur print:hidden">
      <div className="container-x flex h-16 items-center justify-between gap-2 min-[432px]:gap-4">
        <Link href="/" aria-label="Met On Campus, home"><Brand /></Link>
        <nav aria-label="Main" className="hidden items-center gap-7 text-[15px] font-medium text-ink-2 md:flex">
          {links.map((l) => <Link key={l.href} href={l.href} className="hover:text-ink">{l.label}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          {/* On phones the toggle lives inside the menu: brand, button, toggle and menu do not fit one line. */}
          <ThemeToggle className="hidden md:inline-flex" />
          {/* The label sits in one <span>: loose text directly inside a flex button loses its spaces ("Opentheapp").
              Below 432px the label is shortened to "Open app" (screen readers still hear "Open the app") and below 380px the
              button moves into the menu: logo, button and menu do not fit one line any narrower. */}
          <a href={site.appUrl} className="btn hidden h-10 px-4 text-sm min-[380px]:inline-flex min-[432px]:px-5"><span>Open<span className="max-[431px]:sr-only"> the</span> app</span></a>
          <MobileMenu links={links} appUrl={site.appUrl} />
        </div>
      </div>
    </header>
  )
}
