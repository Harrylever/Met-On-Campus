'use client'
import { useSyncExternalStore } from 'react'

export const THEME_KEY = 'moc-theme'
type Theme = 'light' | 'dark'

// The page's inline script (see layout.tsx) sets <html data-theme> before first paint. This hook just reads it,
// so React and the document never disagree, and the label updates whenever the attribute changes.
function subscribe(cb: () => void) {
  const observer = new MutationObserver(cb)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}
const snapshot = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, snapshot, () => 'light' as Theme)
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem(THEME_KEY, next) } catch { /* private mode: the choice just will not persist */ }
  }
  return { theme, toggle }
}

export function SunIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`icon-sun ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}
export function MoonIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`icon-moon ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  )
}

/** Round icon button for the header. Shows the sun when dark (tap for light) and the moon when light (tap for dark). */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  return (
    <button type="button" onClick={toggle} aria-label={label} title={label}
      className={`size-10 items-center justify-center rounded-full border border-line text-ink-2 transition hover:border-ink-3 hover:text-ink ${className}`}>
      <SunIcon /><MoonIcon />
    </button>
  )
}
