'use client'
import { useState, useTransition } from 'react'
import { resolveDepartmentRequest } from '../lists/actions'

type Group = { requestId: string; name: string; university: string; students: number; firstRequestedAt: string; spellings: string[] }
type Dept = { id: string; name: string; university: string | null }
type Recent = { name: string; university: string; status: string; resolvedName: string | null; note: string | null; reviewedAt: string | null; students: number }
const campus = (u: string) => u.charAt(0).toUpperCase() + u.slice(1)
const ago = (iso: string) => { const s = Math.max(0, (Date.now() - +new Date(iso)) / 1000); return s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago` }

export function RequestsPanel({ pending, recent, departments }: { pending: Group[]; recent: Recent[]; departments: Dept[] }) {
  if (pending.length === 0 && recent.length === 0) return null
  return (
    <section aria-labelledby="requests-heading" className="space-y-3">
      <div><h2 id="requests-heading" className="text-lg font-semibold">Department requests</h2>
        <p className="text-sm text-ink-2">Students whose department is not listed. Everyone who asked for the same name on a campus is decided together. Approving moves them onto it; they are told either way.</p></div>
      {pending.length === 0 ? <p className="card text-sm text-ink-2">No open requests.</p> : (
        <ul className="space-y-3">{pending.map((g) => <Request key={g.requestId} group={g} departments={departments.filter((d) => d.university === null || d.university === g.university)} />)}</ul>
      )}
      {recent.length > 0 && (
        <details className="card text-sm">
          <summary className="cursor-pointer font-semibold">Recent decisions</summary>
          <ul className="mt-3 space-y-2">
            {recent.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3">
                <span className={`badge ${r.status === 'declined' ? 'text-warn' : ''}`}>{r.status === 'declined' ? 'Declined' : 'Approved'}</span>
                <span><b>{r.name}</b> <span className="text-ink-2">({campus(r.university)}, {r.students} {r.students === 1 ? 'student' : 'students'})</span>{r.resolvedName && r.resolvedName !== r.name && <> → <b>{r.resolvedName}</b></>}{r.note && <span className="text-ink-2">: {r.note}</span>}</span>
                {r.reviewedAt && <span className="text-xs text-ink-3">{ago(r.reviewedAt)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function Request({ group, departments }: { group: Group; departments: Dept[] }) {
  // Controlled fields: React 19 clears uncontrolled ones after an action, which would wipe a typed reason on an error.
  const [action, setAction] = useState<'approve' | 'merge' | 'decline'>('approve')
  const [name, setName] = useState(group.name)
  const [scope, setScope] = useState<'campus' | 'all'>('campus')
  const [departmentId, setDepartmentId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setError(null)
    const input = action === 'approve' ? { requestId: group.requestId, action, name, scope } as const
      : action === 'merge' ? { requestId: group.requestId, action, departmentId } as const
      : { requestId: group.requestId, action, note } as const
    start(async () => { const r = await resolveDepartmentRequest(input); if (r.error) setError(r.error) })
  }
  const tab = (id: typeof action, label: string) => (
    <label className={`inline-flex h-10 cursor-pointer items-center rounded-lg border px-3 text-sm ${action === id ? 'border-ink bg-subtle font-semibold' : 'border-line'}`}>
      <input type="radio" name={`action-${group.requestId}`} className="sr-only" checked={action === id} onChange={() => { setAction(id); setError(null) }} />{label}
    </label>
  )
  return (
    <li className="card space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">{group.name}</h3>
        <span className="badge">{campus(group.university)}</span>
        <span className="text-sm text-ink-2">{group.students} {group.students === 1 ? 'student asked' : 'students asked'}, first {ago(group.firstRequestedAt)}</span>
      </div>
      {group.spellings.length > 1 && <p className="text-xs text-ink-2">Spelled as: {group.spellings.join(', ')}</p>}
      <form onSubmit={submit} className="space-y-3 border-t border-line pt-3">
        <fieldset className="flex flex-wrap gap-2"><legend className="sr-only">Decision for {group.name}</legend>
          {tab('approve', 'Add as new department')}{tab('merge', 'Use an existing one')}{tab('decline', 'Decline')}</fieldset>
        {action === 'approve' && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-56 flex-1 text-sm font-semibold">Name to add (fix the spelling here)<input className="input mt-2 font-normal" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required /></label>
            <label className="text-sm font-semibold">Offered to<select className="input mt-2 w-52 font-normal" value={scope} onChange={(e) => setScope(e.target.value as 'campus' | 'all')}><option value="campus">{campus(group.university)} only</option><option value="all">All campuses</option></select></label>
          </div>
        )}
        {action === 'merge' && (
          <label className="block text-sm font-semibold">They meant<select className="input mt-2 font-normal" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required>
            <option value="">Choose a department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}{d.university ? '' : ' (all campuses)'}</option>)}</select></label>
        )}
        {action === 'decline' && (
          <label className="block text-sm font-semibold">Reason shown to the student (optional)<input className="input mt-2 font-normal" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="We only list departments the university offers." /></label>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button className={`btn ${action === 'decline' ? 'btn-danger' : ''}`} disabled={pending || (action === 'approve' && !name.trim()) || (action === 'merge' && !departmentId)}>
          {pending ? 'Saving…' : action === 'approve' ? `Add and notify ${group.students}` : action === 'merge' ? `Use it and notify ${group.students}` : `Decline and notify ${group.students}`}
        </button>
      </form>
    </li>
  )
}
