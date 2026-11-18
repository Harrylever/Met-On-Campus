import { useSyncExternalStore } from 'react'

// "Install the app": the browser offers an install event (Chrome, Edge, Android); iPhones have no such event, so we explain
// the Share menu instead. The event can fire before React is on screen, so it is captured here at load.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: InstallEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)
export const isIOS = () => typeof navigator !== 'undefined' && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; notify() })
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; notify() })
}

let snapshot = { canPrompt: false, installed: false }
const read = () => {
  const next = { canPrompt: !!deferred, installed: installed || isStandalone() }
  if (next.canPrompt !== snapshot.canPrompt || next.installed !== snapshot.installed) snapshot = next
  return snapshot
}

export function useInstall() {
  const s = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, read, () => ({ canPrompt: false, installed: false }))
  return {
    ...s,
    ios: isIOS(),
    /** Shows the browser's install dialog. */
    async prompt() {
      if (!deferred) return 'unavailable' as const
      const e = deferred; deferred = null; notify()
      await e.prompt()
      return (await e.userChoice).outcome
    },
  }
}

/** Registers the service worker (offline page, push, notification taps). Safe to call more than once. */
export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const go = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => console.warn('service worker not registered', err))
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true })
}

/** Puts the unread count on the app icon, where the system supports it (installed app). */
export function setAppBadge(n: number) {
  const nav = navigator as { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  try { if (n > 0) void nav.setAppBadge?.(n); else void nav.clearAppBadge?.() } catch { /* not supported */ }
}
