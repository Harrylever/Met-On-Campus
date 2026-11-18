import { useEffect } from 'react'
import { Link, Outlet, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
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
  useEffect(() => { setAppBadge(waiting) }, [waiting])
  useEffect(() => { document.title = waiting > 0 ? `(${waiting}) Met On Campus` : 'Met On Campus' }, [waiting])
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col lg:max-w-6xl">
      <header className="flex flex-col gap-3 px-4 pt-5 lg:flex-row lg:items-center lg:justify-between">
        <Brand />
        {/* Chips get their own row on phones: brand + two chips cannot fit one 358px line without wrapping. */}
        <div className="flex flex-wrap items-center gap-2">
          {onCampusNow != null && <span className="pill"><i className="dot-live" />{onCampusNow} online</span>}
          <VerifiedPill campus={me.user.university} />
        </div>
      </header>
      <InstallBanner />
      {looksLikeMatric(me.user.name) && (
        <div role="status" className="mx-4 mt-4 rounded-[12px] border border-line bg-subtle p-3 text-sm">
          Other students currently see <b>“{me.user.name}”</b>, which can include your matric number.{' '}
          <Link to="/profile" className="font-semibold underline underline-offset-2">Change it to your first name</Link>
        </div>
      )}
      <div className="flex-1 px-4 pb-24 pt-5"><Outlet /></div>
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
