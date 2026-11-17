'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { MoonIcon, SunIcon, useTheme } from './ThemeToggle'

export function MobileMenu({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const path = usePathname()
  const { theme, toggle } = useTheme()

  // The header stays mounted between pages, so close the menu when the page changes.
  useEffect(() => setOpen(false), [path])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey); document.addEventListener('pointerdown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown) }
  }, [open])

  return (
    <div ref={ref} className="relative md:hidden">
      <button type="button" aria-label="Menu" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}
        className="flex size-10 items-center justify-center rounded-full border border-line">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
        </svg>
      </button>
      {open && (
        <nav id="mobile-nav" aria-label="Menu" className="absolute right-0 top-12 w-56 rounded-2xl border border-line bg-surface p-2 shadow-lg">
          {links.map((l) => <Link key={l.href} href={l.href} className="block rounded-xl px-4 py-3 text-[15px] font-medium hover:bg-subtle">{l.label}</Link>)}
          <button type="button" onClick={toggle} className="mt-1 flex w-full items-center justify-between rounded-xl border-t border-line px-4 py-3 text-left text-[15px] font-medium hover:bg-subtle">
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            <span className="text-ink-2"><SunIcon className="size-5" /><MoonIcon className="size-5" /></span>
          </button>
        </nav>
      )}
    </div>
  )
}
