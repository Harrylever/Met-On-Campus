import Link from 'next/link'
import { adminData } from '~/lib/admin-api'
import { ago, title, when } from '~/lib/format'
import { ResolveForm } from './ResolveForm'

type P = { id: string; name: string; department: string; level: number; university: string; status: string }
type Report = { id: string; reason: string; details: string; intent: string | null; status: string; createdAt: string; reviewedAt: string | null; messageSnapshot: string | null; reporter: P | null; reported: (P & { reportsAgainst: number }) | null }
const TABS = [['open', 'Open'], ['reviewed', 'Actioned'], ['dismissed', 'Dismissed']] as const

export default async function Reports({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams
  const status = TABS.some(([s]) => s === sp.status) ? sp.status! : 'open'
  const { reports } = await adminData<{ reports: Report[] }>(`/admin/reports?status=${status}`)
  return (
    <>
      <div><h1 className="text-2xl font-bold">Reports</h1><p className="text-sm text-ink-2">Students report people or messages. You see the saved snapshot of a reported message, never the rest of the chat.</p></div>
      <nav aria-label="Status" className="flex gap-1">
        {TABS.map(([s, l]) => <Link key={s} href={`/reports?status=${s}`} aria-current={s === status ? 'true' : undefined} className={`btn h-9 px-3 ${s === status ? '' : 'btn-ghost'}`}>{l}</Link>)}
      </nav>
      {reports.length === 0 && <p className="card text-sm text-ink-2">{status === 'open' ? 'No open reports. Nothing needs review.' : 'Nothing here yet.'}</p>}
      <ul className="space-y-3">
        {reports.map((r) => (
          <li key={r.id} className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge">{title(r.reason)}</span>
              {r.intent && <span className="badge">{title(r.intent)} mode</span>}
              {r.reported && r.reported.reportsAgainst > 1 && <span className="badge text-danger">{r.reported.reportsAgainst} reports against</span>}
              {r.reported?.status === 'suspended' && <span className="badge text-danger">Suspended</span>}
              <span className="ml-auto text-xs text-ink-2" title={when(r.createdAt)}>{ago(r.createdAt)}</span>
            </div>
            <p className="text-sm">
              <b>{r.reporter?.name ?? 'Unknown'}</b> <span className="text-ink-2">({r.reporter?.department} {r.reporter?.level}L)</span> reported{' '}
              {r.reported ? <Link className="font-semibold underline underline-offset-2" href={`/users/${r.reported.id}`}>{r.reported.name}</Link> : 'a deleted account'}{' '}
              <span className="text-ink-2">{r.reported && `(${r.reported.department} ${r.reported.level}L, ${r.reported.university})`}</span>
            </p>
            {r.messageSnapshot && <blockquote className="rounded-lg border-l-2 border-line bg-subtle p-3 text-sm"><span className="label mb-1 block">Reported message</span>{r.messageSnapshot}</blockquote>}
            {r.details && <p className="text-sm text-ink-2"><span className="label mr-2">Reporter says</span>{r.details}</p>}
            {r.status === 'open' && r.reported ? <ResolveForm reportId={r.id} name={r.reported.name} />
              : <p className="text-xs text-ink-2">{r.status === 'dismissed' ? 'Dismissed' : 'Actioned'} {r.reviewedAt && when(r.reviewedAt)}</p>}
          </li>
        ))}
      </ul>
    </>
  )
}
