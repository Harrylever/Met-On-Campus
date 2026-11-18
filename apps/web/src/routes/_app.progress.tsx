import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '~/lib/api'
import { Skeleton } from '~/components/Skeleton'

export const Route = createFileRoute('/_app/progress')({ component: Progress })

// The API client quietly turns date-looking strings into Date objects, so a day can arrive as either. Always work with 'YYYY-MM-DD'.
const ymd = (d: unknown): string => (typeof d === 'string' ? d.slice(0, 10) : new Date(d as Date).toISOString().slice(0, 10))

const LETTER = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString([], { weekday: 'narrow', timeZone: 'UTC' })
const LONG = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString([], { weekday: 'long', timeZone: 'UTC' })
const when = (day: string, today: string) => {
  const diff = Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000)
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : new Date(`${day}T12:00:00Z`).toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
const SHARE_TEXT = 'Join me on Met On Campus: find study partners and friends on campus. Only verified university students can join.'

function Progress() {
  const q = useQuery({ queryKey: ['progress'], queryFn: () => unwrap(api.me.progress.get()) })
  const p = q.data && { ...q.data, today: ymd(q.data.today), week: q.data.week.map((w) => ({ ...w, day: ymd(w.day) })), recent: q.data.recent.map((r) => ({ ...r, day: ymd(r.day) })) }
  return (
    <div className="flex flex-col gap-5">
      <header className="space-y-1">
        <h1 className="text-[28px] font-bold leading-[34px]">Your progress</h1>
        <p className="text-ink-2">Open the app each day, connect with people and invite friends to earn points. Romance never earns points.</p>
      </header>
      {q.isError && <p role="alert" className="card text-danger">Could not load your progress. Try again in a moment.</p>}
      {!p && !q.isError && <div className="space-y-4" aria-hidden="true"><Skeleton className="h-44 w-full !rounded-[16px]" /><Skeleton className="h-52 w-full !rounded-[16px]" /></div>}
      {p && <>
        <section className="card space-y-4" aria-labelledby="streak-heading">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 id="streak-heading" className="label">Daily streak</h2>
              <p className="font-display text-[56px] font-bold leading-none tracking-tight">{p.streak.current}<span className="ml-2 text-lg font-semibold text-ink-2">{p.streak.current === 1 ? 'day' : 'days'}</span></p>
            </div>
            <p className="text-right text-sm text-ink-2">Best: {Math.max(p.streak.best, p.streak.current)} {Math.max(p.streak.best, p.streak.current) === 1 ? 'day' : 'days'}</p>
          </div>
          <ol className="grid grid-cols-7 gap-2" aria-label="Your last 7 days">
            {p.week.map((d) => (
              <li key={d.day} className="flex flex-col items-center gap-1">
                <span aria-hidden="true" className={`flex size-9 items-center justify-center rounded-full border text-sm font-semibold ${d.active ? 'border-ink bg-ink text-white' : 'border-line text-ink-3'}`}>{d.active ? '✓' : ''}</span>
                <span className="text-xs text-ink-2" aria-hidden="true">{LETTER(d.day)}</span>
                <span className="sr-only">{LONG(d.day)}: {d.active ? 'opened the app' : 'did not open the app'}</span>
              </li>
            ))}
          </ol>
          <p className="text-sm text-ink-2" role="status">
            {p.streak.checkedInToday ? 'You are checked in for today.' : 'Open the app each day to keep your streak going.'}{' '}
            {p.streak.restAvailable ? 'You have a free rest day this week: one missed day will not break it.' : 'Your free rest day for this week is used.'}
          </p>
        </section>

        <section className="card space-y-3" aria-labelledby="points-heading">
          <div className="flex items-end justify-between gap-3">
            <div><h2 id="points-heading" className="label">Points</h2><p className="font-display text-[44px] font-bold leading-none tracking-tight">{p.points}</p></div>
          </div>
          {p.recent.length === 0 ? <p className="text-sm text-ink-2">Nothing yet. Opening the app today earns your first points.</p> : (
            <ul className="divide-y divide-line text-sm">
              {p.recent.map((r) => <li key={r.id} className="flex items-baseline justify-between gap-3 py-2"><span>{r.label}</span><span className="shrink-0 text-ink-2"><span className="font-semibold text-ink">+{r.points}</span> · {when(r.day, p.today)}</span></li>)}
            </ul>
          )}
        </section>

        <InviteCard invite={p.invite} />

        <details className="card text-sm">
          <summary className="cursor-pointer text-[17px] font-semibold">How points work</summary>
          <ul className="mt-3 space-y-2">
            {p.rules.map((r) => <li key={r.kind} className="flex justify-between gap-4"><span>{r.how}</span><span className="shrink-0 font-semibold">+{r.points}</span></li>)}
          </ul>
          <p className="mt-3 text-ink-2">The things you can repeat (check-ins, connections, rooms, meetups) stop paying at 60 points a day. Days follow Nigerian time. Points have no cash value and can be removed if they were earned unfairly. Everything in Romance is private and earns nothing.</p>
        </details>
      </>}
      <Link to="/profile" className="text-sm font-semibold text-ink underline underline-offset-2">Back to Profile</Link>
    </div>
  )
}

type Invite = { url: string; invited: number; rewarded: number; pending: number; monthUsed: number; monthMax: number; activeDays: number }
function InviteCard({ invite }: { invite: Invite }) {
  const [note, setNote] = useState('')
  const canShare = typeof navigator !== 'undefined' && !!navigator.share
  const copy = async () => {
    try { await navigator.clipboard.writeText(invite.url); setNote('Link copied.') } catch { setNote('Could not copy. Select the link and copy it.') }
  }
  const share = async () => { try { await navigator.share({ title: 'Met On Campus', text: SHARE_TEXT, url: invite.url }) } catch { /* closed the share sheet */ } }
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${SHARE_TEXT} ${invite.url}`)}`
  return (
    <section className="card space-y-3" aria-labelledby="invite-heading">
      <h2 id="invite-heading" className="text-[17px] font-semibold">Invite a friend</h2>
      <p className="text-sm text-ink-2">When a friend joins with your link, sets up their account and opens the app on {invite.activeDays} different days, you each get 30 points. You can earn this for up to {invite.monthMax} friends a month. Your link never shows your name to anyone who is not yet a member.</p>
      <label className="block text-sm font-semibold">Your invite link
        <input readOnly className="input mt-2 font-mono text-xs font-normal" value={invite.url} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div className="flex flex-wrap gap-2">
        {canShare && <button type="button" className="btn h-11 px-4" onClick={share}>Share</button>}
        <a className="btn btn-ghost h-11 px-4" href={whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        <button type="button" className="btn btn-ghost h-11 px-4" onClick={copy}>Copy link</button>
      </div>
      <p role="status" className="min-h-5 text-sm text-ink-2">{note}</p>
      <p className="text-sm text-ink-2">Joined with your link: <b className="text-ink">{invite.invited}</b>. Earned points: <b className="text-ink">{invite.rewarded}</b>. Still settling in: <b className="text-ink">{invite.pending}</b>. This month: <b className="text-ink">{invite.monthUsed}/{invite.monthMax}</b>.</p>
    </section>
  )
}
