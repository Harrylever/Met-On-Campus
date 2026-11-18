import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '~/lib/api'

/** Profile card: streak and points at a glance, and the way in to the Progress page. */
export function ProgressCard() {
  const q = useQuery({ queryKey: ['progress'], queryFn: () => unwrap(api.me.progress.get()) })
  const p = q.data
  return (
    <Link to="/progress" className="card flex items-center justify-between gap-4 no-underline hover:border-ink">
      <span>
        <span className="block text-[17px] font-semibold">Your progress</span>
        <span className="block text-sm text-ink-2">{p ? `${p.streak.current}-day streak · ${p.points} points` : 'Streak, points and invites'}</span>
      </span>
      <span className="text-sm font-semibold underline underline-offset-2">Open</span>
    </Link>
  )
}
