'use client'
import { useState, useTransition } from 'react'
import { resolvePhoto } from './actions'

export type Photo = { id: string; intent: 'study' | 'friends' | 'romance'; createdAt: string; reviewedAt: string | null; userId: string; name: string; university: string; department: string; level: number; replacing?: boolean }

const REASONS = [
  'Your face is not clearly visible. Please upload a clear photo of yourself.',
  'Please upload a photo with only you in it.',
  'This photo is not appropriate for Met On Campus.',
  'The photo is too dark or blurry. Please try another.',
]
const campus = (u: string) => u.charAt(0).toUpperCase() + u.slice(1)
const ago = (iso: string) => { const s = Math.max(0, (Date.now() - +new Date(iso)) / 1000); return s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago` }
const modeBadge = { study: 'badge', friends: 'badge', romance: 'badge text-warn' } as const

export function PhotoReview({ pending, live }: { pending: Photo[]; live: Photo[] }) {
  return (
    <div className="space-y-8">
      <section aria-labelledby="queue-heading" className="space-y-3">
        <h2 id="queue-heading" className="text-lg font-semibold">Waiting for review ({pending.length})</h2>
        {pending.length === 0 ? <p className="card text-sm text-ink-2">Nothing is waiting.</p> : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{pending.map((p) => <Pending key={p.id} photo={p} />)}</ul>
        )}
      </section>
      {live.length > 0 && (
        <section aria-labelledby="live-heading" className="space-y-3">
          <div><h2 id="live-heading" className="text-lg font-semibold">Live photos</h2><p className="text-sm text-ink-2">Most recently approved. Take one down if it should not be shown.</p></div>
          <ul className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">{live.map((p) => <Live key={p.id} photo={p} />)}</ul>
        </section>
      )}
    </div>
  )
}

function Picture({ id, name }: { id: string; name: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/photos/image/${id}`} alt={`Uploaded photo from ${name}`} width={640} height={640} loading="lazy" className="aspect-square w-full rounded-lg border border-line bg-subtle object-cover" />
}

function Pending({ photo }: { photo: Photo }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState(REASONS[0]!)
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()
  const run = (action: 'approve' | 'reject') => { setError(null); start(async () => { const r = await resolvePhoto({ photoId: photo.id, action, note: action === 'reject' ? (custom.trim() || reason) : undefined }); if (r.error) setError(r.error) }) }
  return (
    <li className="card space-y-3">
      <Picture id={photo.id} name={photo.name} />
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold">{photo.name}</h3><span className={modeBadge[photo.intent]}>{photo.intent}</span><span className="badge">{campus(photo.university)}</span></div>
        <p className="text-sm text-ink-2">{photo.level}L {photo.department}, uploaded {ago(photo.createdAt)}</p>
        {photo.replacing && <p className="text-xs text-ink-2">Replaces a live photo. The current one stays up until you approve this.</p>}
      </div>
      {rejecting ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run('reject') }}>
          <label className="block text-sm font-semibold">Reason shown to the student
            <select className="input mt-2 font-normal" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
          <label className="block text-sm font-semibold">Or write your own (optional)
            <input className="input mt-2 font-normal" value={custom} maxLength={200} onChange={(e) => setCustom(e.target.value)} /></label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2"><button className="btn btn-danger" disabled={busy}>{busy ? 'Saving…' : 'Reject and notify'}</button><button type="button" className="btn btn-ghost" onClick={() => setRejecting(false)}>Back</button></div>
        </form>
      ) : (
        <div className="space-y-2">
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2"><button className="btn" disabled={busy} onClick={() => run('approve')}>{busy ? 'Saving…' : 'Approve'}</button><button className="btn btn-ghost" disabled={busy} onClick={() => setRejecting(true)}>Reject</button></div>
        </div>
      )}
    </li>
  )
}

function Live({ photo }: { photo: Photo }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, start] = useTransition()
  const remove = () => start(async () => { const r = await resolvePhoto({ photoId: photo.id, action: 'remove', note: 'This photo was removed by our team.' }); if (r.error) setError(r.error) })
  return (
    <li className="card space-y-2 p-3">
      <Picture id={photo.id} name={photo.name} />
      <p className="text-sm font-semibold">{photo.name} <span className={modeBadge[photo.intent]}>{photo.intent}</span></p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {confirming
        ? <div className="flex gap-2"><button className="btn btn-danger h-9 px-3 text-sm" disabled={busy} onClick={remove}>{busy ? 'Removing…' : 'Remove it'}</button><button className="btn btn-ghost h-9 px-3 text-sm" onClick={() => setConfirming(false)}>Keep</button></div>
        : <button className="btn btn-ghost h-9 px-3 text-sm" onClick={() => setConfirming(true)}>Take down</button>}
    </li>
  )
}
