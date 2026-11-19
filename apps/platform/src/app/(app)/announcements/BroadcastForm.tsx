'use client'
import { useEffect, useState, useTransition } from 'react'
import { previewAudience, sendBroadcast } from './actions'

type Campus = { slug: string; name: string }
type Dept = { name: string; university: string }
type Reach = { students: number; devices: number }
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function BroadcastForm({ campuses, departments }: { campuses: Campus[]; departments: Dept[] }) {
  // Controlled fields: React 19 clears uncontrolled ones after an action, which would wipe the text on an error.
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('/discover')
  const [campus, setCampus] = useState('')
  const [dept, setDept] = useState('')
  const [reach, setReach] = useState<Reach | null>(null)
  const [reachError, setReachError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // Fresh count whenever the audience changes (an answer for an older choice is ignored).
  useEffect(() => {
    let current = true
    setReach(null); setReachError(null)
    previewAudience(campus, dept).then((r) => {
      if (!current) return
      if (r.error) setReachError(r.error); else setReach({ students: r.students ?? 0, devices: r.devices ?? 0 })
    }).catch(() => current && setReachError('Could not count the audience.'))
    return () => { current = false }
  }, [campus, dept])

  const audienceLabel = !campus ? 'All campuses' : `${campuses.find((c) => c.slug === campus)?.name ?? campus}${dept ? `, ${dept}` : ', all departments'}`
  const valid = title.trim().length > 0 && body.trim().length > 0
  const canSend = valid && !!reach && reach.devices > 0

  const confirm = () => {
    setError(null)
    start(async () => {
      const r = await sendBroadcast({ title, body, url, university: campus, department: dept })
      setConfirming(false)
      if (r.error) return setError(r.error)
      setDone(`Sending to ${plural(r.students ?? 0, 'student', 'students')} (${plural(r.devices ?? 0, 'device', 'devices')}). Refresh the history below to see how many devices accepted it.`)
      setTitle(''); setBody(''); setUrl('/discover')
    })
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); setDone(null); setError(null); setConfirming(true) }} className="card space-y-4">
      <label className="block text-sm font-semibold">Title <span className="font-normal text-ink-3">({title.length}/50)</span>
        <input className="input mt-2 font-normal" value={title} maxLength={50} required onChange={(e) => { setTitle(e.target.value); setConfirming(false) }} />
      </label>
      <label className="block text-sm font-semibold">Message <span className="font-normal text-ink-3">({body.length}/140)</span>
        <textarea className="input mt-2 h-24 py-2 font-normal" value={body} maxLength={140} required onChange={(e) => { setBody(e.target.value); setConfirming(false) }} />
      </label>
      <label className="block text-sm font-semibold">Opens this page in the app
        <input className="input mt-2 font-mono font-normal" value={url} maxLength={200} onChange={(e) => { setUrl(e.target.value); setConfirming(false) }} />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm font-semibold">Campus
          <select className="input mt-2 w-52 font-normal" value={campus} onChange={(e) => { setCampus(e.target.value); setDept(''); setConfirming(false) }}>
            <option value="">All campuses</option>
            {campuses.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        {campus && (
          <label className="text-sm font-semibold">Department
            <select className="input mt-2 w-60 font-normal" value={dept} onChange={(e) => { setDept(e.target.value); setConfirming(false) }}>
              <option value="">All departments</option>
              {departments.filter((d) => d.university === campus).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <p role="status" className="text-sm text-ink-2">
        {reachError ? <span className="text-danger">{reachError}</span>
          : !reach ? 'Counting who this reaches…'
          : reach.devices === 0 ? 'Nobody in this audience has notifications turned on.'
          : <>Reaches <b className="text-ink">{plural(reach.students, 'student', 'students')}</b> ({plural(reach.devices, 'device', 'devices')}) with notifications turned on.</>}
      </p>
      <p className="text-xs text-ink-3">This text can appear on a locked phone screen where other people can read it. Do not include names or personal details.</p>

      {confirming ? (
        <div className="space-y-3 rounded-lg border border-line bg-subtle p-3 text-sm" role="alertdialog" aria-labelledby="confirm-heading">
          <p id="confirm-heading" className="font-semibold">Send this to {plural(reach?.students ?? 0, 'student', 'students')}? It cannot be recalled.</p>
          <div className="rounded-lg border border-line bg-surface p-3"><p className="font-semibold">{title.trim()}</p><p>{body.trim()}</p><p className="mt-1 font-mono text-xs text-ink-3">Opens {url.trim() || '/discover'} · {audienceLabel}</p></div>
          <div className="flex gap-2">
            <button type="button" className="btn" disabled={pending} onClick={confirm}>{pending ? 'Sending…' : 'Confirm and send'}</button>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : <button className="btn" disabled={!canSend}>Review and send</button>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {done && <p role="status" className="text-sm text-ok">{done}</p>}
    </form>
  )
}
