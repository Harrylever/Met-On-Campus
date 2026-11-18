import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, createFileRoute, redirect, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '~/lib/api'
import { looksLikeMatric } from '~/lib/name'
import { registerServiceWorker, setAppBadge } from '~/lib/pwa'
import { syncPush } from '~/lib/push'
import { InstallBanner } from '~/components/InstallApp'
import { useRealtime } from '~/lib/realtime'
import { Brand, VerifiedPill } from '~/components/ui'
import { ShellSkeleton } from '~/components/Skeleton'

export const Route = createFileRoute('/_app')({ ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await api.me.get()
    // Signed out (for example the session ran out): sign in, then come back to this page.
    if (!data) throw redirect({ to: '/login', search: { redirect: location.pathname as '/discover' } })
    if (!data.onboarded) throw redirect({ to: '/onboarding' })
    return { me: data }
  },
  pendingComponent: ShellSkeleton, // shown while the account check runs, on first open and on slow connections
  component: Shell,
})

// What a screen reader announces as the page name when you move between screens.
const PAGE: Record<string, string> = { '/discover': 'Discover', '/rooms': 'Rooms', '/messages': 'Messages', '/profile': 'Profile', '/progress': 'Progress' }
const NAV = [{ to: '/discover', label: 'Discover' }, { to: '/rooms', label: 'Rooms' }, { to: '/messages', label: 'Messages' }, { to: '/profile', label: 'Profile' }] as const

function Shell() {
  const { me } = Route.useRouteContext()
  // Having the app open counts as "online". We say so plainly until we can tell who is physically on campus.
  const router = useRouter()
  // When staff decide a department request, reload the signed-in user so their own department updates too.
  const { onCampusNow } = useRealtime({ onCampus: true, onDepartmentDecision: () => router.invalidate() })
  // What is waiting for you (unread chats, unanswered invites). Pushes keep it fresh; it also refreshes when you return to the tab.
  const unread = useQuery({ queryKey: ['unread'], queryFn: () => unwrap(api.me.unread.get()) })
  const waiting = (unread.data?.total ?? 0) + (unread.data?.rooms ?? 0)
  useEffect(() => { registerServiceWorker(); void syncPush() }, [])
  // Opening the app counts as the day's check-in (the server counts a Nigerian day once, however often this runs).
  // A new streak milestone, a rest day that saved your streak, or joining through a friend is worth saying.
  const qc = useQueryClient()
  const [reward, setReward] = useState<string | null>(null)
  useEffect(() => {
    let last = 0
    const run = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 30 * 60_000) return
      last = Date.now()
      try {
        const r = await unwrap(api.me.checkin.post())
        if (r.alreadyCheckedIn) return
        void qc.invalidateQueries({ queryKey: ['progress'] })
        const m = r.awarded.find((a) => a.kind.startsWith('streak_'))
        const friend = r.awarded.find((a) => a.kind === 'invited_by_friend')
        setReward(m ? `${m.kind.replace('streak_', '')}-day streak! You earned ${m.points} points.` : friend ? `Thanks for joining through a friend. You earned ${friend.points} points.` : r.restUsed ? 'A rest day kept your streak going.' : null)
      } catch { /* a missed check-in is harmless: the next visit counts */ }
    }
    void run()
    document.addEventListener('visibilitychange', run)
    return () => document.removeEventListener('visibilitychange', run)
  }, [qc])
  useEffect(() => { setAppBadge(waiting) }, [waiting])
  // A single-page app never reloads, so tell assistive technology the page changed: a new title, and focus moves to the page itself.
  const path = useRouterState({ select: (s) => s.location.pathname })
  const page = PAGE[path]
  useEffect(() => { document.title = `${waiting > 0 ? `(${waiting}) ` : ''}${page ? `${page} · ` : ''}Met On Campus` }, [waiting, page])
  const main = useRef<HTMLElement>(null)
  const firstPath = useRef(path)
  useEffect(() => { if (path !== firstPath.current) main.current?.focus({ preventScroll: true }) }, [path])
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col lg:max-w-6xl">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-[10px] focus:bg-ink focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-white">Skip to content</a>
      <header className="flex flex-col gap-3 px-4 pt-5 lg:flex-row lg:items-center lg:justify-between">
        <Brand />
        {/* Chips get their own row on phones: brand + two chips cannot fit one 358px line without wrapping. */}
        <div className="flex flex-wrap items-center gap-2">
          {onCampusNow != null && <span className="pill"><i className="dot-live" />{onCampusNow} online</span>}
          <VerifiedPill campus={me.user.university} />
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1} className="flex-1 px-4 pb-24 pt-5">
      <InstallBanner />
      {reward && (
        <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-[12px] border border-line bg-subtle p-3 text-sm">
          <span>{reward} <Link to="/progress" className="font-semibold underline underline-offset-2">See your progress</Link></span>
          <button type="button" className="btn btn-ghost h-9 px-3 text-sm" onClick={() => setReward(null)}>Dismiss</button>
        </div>
      )}
      {looksLikeMatric(me.user.name) && (
        <div role="status" className="mb-4 rounded-[12px] border border-line bg-subtle p-3 text-sm">
          Other students currently see <b>“{me.user.name}”</b>, which can include your matric number.{' '}
          <Link to="/profile" className="font-semibold underline underline-offset-2">Change it to your first name</Link>
        </div>
      )}
      <Outlet />
      </main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 mx-auto flex h-16 max-w-md border-t border-line bg-surface lg:max-w-6xl">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className="flex flex-1 items-center justify-center text-[13px] font-medium text-ink-2" activeProps={{ className: 'font-semibold !text-ink border-t-2 border-ink -mt-px' }}>
            {n.label}
            {(() => { const n2 = n.to === '/messages' ? (unread.data?.total ?? 0) : n.to === '/rooms' ? (unread.data?.rooms ?? 0) : 0; return n2 > 0 && <span className="ml-1.5 min-w-5 rounded-full bg-ink px-1.5 text-center font-mono text-[11px] leading-5 text-white"><span className="sr-only">{n2} waiting</span><span aria-hidden>{n2}</span></span> })()}
          </Link>
        ))}
      </nav>
    </div>
  )
}
