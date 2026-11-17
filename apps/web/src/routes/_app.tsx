import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { api } from '~/lib/api'
import { useRealtime } from '~/lib/realtime'
import { Brand, VerifiedPill } from '~/components/ui'

export const Route = createFileRoute('/_app')({ ssr: false,
  beforeLoad: async () => {
    const { data } = await api.me.get()
    if (!data) throw redirect({ to: '/login' })
    if (!data.onboarded) throw redirect({ to: '/onboarding' })
    return { me: data }
  },
  component: Shell,
})

const NAV = [{ to: '/discover', label: 'Discover' }, { to: '/rooms', label: 'Rooms' }, { to: '/messages', label: 'Messages' }, { to: '/profile', label: 'Profile' }] as const

function Shell() {
  const { me } = Route.useRouteContext()
  // Having the app open counts as "On Campus Now" until we add geofencing / a manual toggle.
  const { onCampusNow } = useRealtime({ onCampus: true })
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col lg:max-w-6xl">
      <header className="flex items-center justify-between gap-3 px-4 pt-5">
        <Brand />
        <span className="flex items-center gap-2">
          {onCampusNow != null && <span className="pill"><i className="dot-live" />{onCampusNow} on campus</span>}
          <VerifiedPill campus={me.user.university} />
        </span>
      </header>
      <div className="flex-1 px-4 pb-24 pt-5"><Outlet /></div>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 mx-auto flex h-16 max-w-md border-t border-line bg-surface lg:max-w-6xl">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className="flex flex-1 items-center justify-center text-[13px] font-medium text-ink-2" activeProps={{ className: 'font-semibold !text-ink border-t-2 border-ink -mt-px' }}>{n.label}</Link>
        ))}
      </nav>
    </div>
  )
}
