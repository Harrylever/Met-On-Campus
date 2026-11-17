import { adminData } from '~/lib/admin-api'
import { BarChart, Stat } from '~/components/Charts'
import { nf } from '~/lib/format'

type Day = { day: string; n: number }
type Overview = {
  totals: { students: number; suspended: number; openReports: number; onCampusNow: number; modes: Record<string, number>; rooms: { live: number; upcoming: number } }
  campuses: { university: string; students: number; onCampusNow: number }[]
  days: number
  series: Record<'signups' | 'activeStudents' | 'messages' | 'connections' | 'reports', Day[]>
}
const pts = (d: Day[]) => d.map((x) => ({ label: new Date(x.day + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), value: x.n }))

export default async function Overview({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams
  const days = [7, 14, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 14
  const o = await adminData<Overview>(`/admin/overview?days=${days}`)
  const t = o.totals
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Overview</h1><p className="text-sm text-ink-2">Everything happening across Met On Campus.</p></div>
        <nav aria-label="Range" className="flex gap-1">
          {[7, 14, 30, 90].map((d) => <a key={d} href={`/?days=${d}`} aria-current={d === days ? 'true' : undefined} className={`btn h-9 px-3 ${d === days ? '' : 'btn-ghost'}`}>{d}d</a>)}
        </nav>
      </div>

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Students" value={t.students} note={t.suspended ? `${t.suspended} suspended` : 'none suspended'} />
        <Stat label="On campus now" value={t.onCampusNow} note="live presence" />
        <Stat label="Open reports" value={t.openReports} tone={t.openReports ? 'danger' : undefined} note={t.openReports ? 'needs review' : 'all clear'} />
        <Stat label="Rooms" value={`${t.rooms.live} live`} note={`${t.rooms.upcoming} upcoming`} />
        <Stat label="Study mode" value={t.modes.study ?? 0} note="profiles on" />
        <Stat label="Friends mode" value={t.modes.friends ?? 0} note="profiles on" />
        <Stat label="Romance mode" value={t.modes.romance ?? 0} note="profiles on" />
        <Stat label="Campuses" value={o.campuses.length} />
      </section>

      <section aria-label={`Last ${days} days`} className="grid gap-3 lg:grid-cols-2">
        <BarChart title="New students" unit="signups" data={pts(o.series.signups)} />
        <BarChart title="Active students" unit="students" data={pts(o.series.activeStudents)} />
        <BarChart title="Messages sent" unit="messages" data={pts(o.series.messages)} />
        <BarChart title="Connection requests" unit="requests" data={pts(o.series.connections)} />
        <BarChart title="Reports filed" unit="reports" data={pts(o.series.reports)} />
      </section>
      <p className="text-xs text-ink-2">Active means the student sent a message or connection request, or asked to join a room that day.</p>

      <section className="card overflow-x-auto">
        <h2 className="mb-3 text-lg font-semibold">Campuses</h2>
        <table className="w-full text-left text-sm"><thead><tr className="label"><th className="pb-2 font-medium">Campus</th><th className="pb-2 font-medium">Students</th><th className="pb-2 font-medium">On campus now</th></tr></thead>
          <tbody>{o.campuses.map((c) => <tr key={c.university} className="border-t border-line"><td className="py-2 capitalize">{c.university}</td><td className="py-2 tabular-nums">{nf.format(c.students)}</td><td className="py-2 tabular-nums">{c.onCampusNow}</td></tr>)}</tbody></table>
      </section>
    </>
  )
}
