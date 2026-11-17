'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'

type Ev = { at: string; kind: 'signup' | 'room' | 'report' | 'moderation'; text: string; link: string | null }
const KIND: Record<Ev['kind'], string> = { signup: 'Signup', room: 'Room', report: 'Report', moderation: 'Moderation' }
const ago = (iso: string) => { const s = Math.max(0, (Date.now() - +new Date(iso)) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago` }

export function ActivityFeed({ initial }: { initial: Ev[] }) {
  const [events, setEvents] = useState(initial)
  const [live, setLive] = useState(true)
  useEffect(() => {
    if (!live) return
    const tick = async () => { try { const r = await fetch('/api/activity', { cache: 'no-store' }); if (r.status === 401) { location.href = '/login?expired=1'; return } if (r.ok) setEvents((await r.json()).events) } catch {} }
    const t = setInterval(tick, 10_000)
    return () => clearInterval(t)
  }, [live])
  return (
    <>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={live} onChange={(e) => setLive(e.target.checked)} />Refresh every 10 seconds</label>
      <ul className="card divide-y divide-line p-0" aria-live="polite">
        {events.map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex items-start gap-3 p-3 text-sm">
            <span className="badge shrink-0">{KIND[e.kind]}</span>
            <span className="min-w-0 flex-1">{e.link ? <Link href={e.link} className="underline underline-offset-2">{e.text}</Link> : e.text}</span>
            <span className="shrink-0 text-xs text-ink-2">{ago(e.at)}</span>
          </li>
        ))}
        {events.length === 0 && <li className="p-6 text-center text-sm text-ink-2">Nothing yet.</li>}
      </ul>
    </>
  )
}
