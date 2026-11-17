import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, INTENTS, type Intent } from '~/lib/api'
import { IntentTabs } from '~/components/ui'
import { deptLabel } from '~/lib/dept'
import { photoUrl } from '~/components/Avatar'
import { LoadingRegion, Skeleton, StudentCardSkeleton, useSkeleton } from '~/components/Skeleton'
import { SafetyMenu } from '~/components/safety'

export const Route = createFileRoute('/_app/discover')({ component: Discover })

const COPY: Record<Intent, { title: string; desc: string; cta: string; sent: string; label: string; wants: string }> = {
  study: { title: 'Study partners on campus', desc: 'Students revising the same courses as you this week.', cta: 'Invite to Study', sent: 'Invite Sent', label: 'Studying this week', wants: 'invited you to study together' },
  friends: { title: 'Friends on campus', desc: 'People from clubs, teams and hangouts around campus.', cta: 'Say Hi', sent: 'Hi Sent', label: 'Up for', wants: 'said hi' },
  romance: { title: 'Someone worth meeting', desc: 'Shown only to students who also turned on Romance Mode. Take your time.', cta: 'Send Spark', sent: 'Spark Sent', label: 'Looking for', wants: 'sent you a Spark' },
}

function Discover() {
  const { me } = Route.useRouteContext()
  const enabled = INTENTS.filter((i) => me.profiles.some((p) => p.intent === i.id && p.enabled))
  const [intent, setIntent] = useState<Intent>(enabled[0]?.id ?? 'study')
  const [dept, setDept] = useState<string>('')
  const [level, setLevel] = useState<number | ''>('')
  const [open, setOpen] = useState<string | null>(null)
  const qc = useQueryClient()
  const c = COPY[intent]

  const feed = useQuery({
    queryKey: ['discover', intent, dept, level],
    queryFn: () => unwrap(api.discover.get({ query: { intent, ...(dept && { department: dept }), ...(level && { level }) } })),
  })
  const connect = useMutation({
    mutationFn: (toUserId: string) => unwrap(api.connections.post({ toUserId, intent })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discover'] }),
  })
  const answer = useMutation({
    mutationFn: (v: { id: string; status: 'accepted' | 'declined' }) => unwrap(api.connections({ id: v.id }).patch({ status: v.status })),
    onSuccess: () => { for (const k of ['discover', 'conversations', 'unread']) qc.invalidateQueries({ queryKey: [k] }) },
  })
  const cards = feed.data?.cards ?? []
  const showSkeleton = useSkeleton(feed.isLoading)
  const depts = [...new Set(cards.map((x) => x.department))]

  return (
    <div data-intent={intent} className="flex flex-col gap-5 lg:grid lg:grid-cols-[320px_1fr] lg:items-start lg:gap-8">
      <aside className="flex flex-col gap-5 lg:sticky lg:top-5">
        <IntentTabs value={intent} onChange={setIntent} options={enabled} />
        <section className="space-y-2 rounded-[20px] border border-(--i-line) bg-(--i-bg) p-5">
          <span className="label text-(--i-ink)">{intent} mode</span>
          <h1 className="text-[28px] font-bold leading-[34px]">{c.title}</h1>
          <p>{c.desc}</p>
          <p className="label flex items-center gap-1.5 pt-2 text-ink"><i className="dot-live" />{feed.isLoading ? <Skeleton className="h-3.5 w-24" /> : `${feed.data?.onCampusNow ?? 0} online now`}</p>
        </section>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0" role="group" aria-label="Department">
          <button className="chip" aria-pressed={!dept} onClick={() => setDept('')}>All departments</button>
          {depts.map((d) => <button key={d} className="chip" aria-pressed={dept === d} onClick={() => setDept(d)}>{deptLabel(d)}</button>)}
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0" role="group" aria-label="Level">
          <button className="chip" aria-pressed={!level} onClick={() => setLevel('')}>All levels</button>
          {[100, 200, 300, 400, 500].map((l) => <button key={l} className="chip font-mono text-xs" aria-pressed={level === l} onClick={() => setLevel(l)}>{l}L</button>)}
        </div>
      </aside>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between"><span className="label text-ink">{feed.isLoading ? <Skeleton className="h-3.5 w-20" /> : <>{cards.length} {cards.length === 1 ? 'student' : 'students'}</>}</span><span className="label">Online first</span></div>
        {feed.isError && <p role="alert" className="card text-danger">Could not load students. Try again in a moment.</p>}
        {!feed.isLoading && cards.length === 0 && <div className="card space-y-2"><h2 className="text-[17px] font-semibold">No students match these filters</h2><p className="text-ink-2">Try another department or level, or clear both.</p><button className="btn btn-ghost" onClick={() => { setDept(''); setLevel('') }}>Clear Filters</button></div>}
        {showSkeleton && <LoadingRegion label="Loading students" className="grid gap-4 xl:grid-cols-2">{[0, 1, 2].map((i) => <StudentCardSkeleton key={i} />)}</LoadingRegion>}
        <div className="grid gap-4 xl:grid-cols-2">
        {cards.map((s) => {
          const isOpen = open === s.userId
          return (
            <article key={s.userId} className="card flex flex-col gap-3 p-0 overflow-hidden">
              <div className={`relative flex ${s.photoId ? 'h-72' : 'h-40'} flex-col items-center justify-center bg-(--i-bg) font-display text-[96px] font-bold leading-none text-(--i-ink)`} aria-hidden>
                {s.photoId ? <img src={photoUrl(s.photoId)} alt="" className="absolute inset-0 size-full object-cover object-[50%_25%]" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : s.name[0]}
                {s.onCampusNow && <span className="pill absolute right-3 top-3"><i className="dot-live" />Online now</span>}
              </div>
              <div className="flex flex-col gap-3 p-4 pt-1">
                <div>
                  <h2 className="text-[17px] font-semibold">{s.name} • {s.level}L {deptLabel(s.department)}</h2>
                  <span className="text-[13px] text-ink-2">{s.usualSpot ? `Usually at ${s.usualSpot}` : 'No usual spot yet'}</span>
                </div>
                {s.prompt && <div className="rounded-[10px] border border-(--i-line) bg-(--i-bg) p-3"><span className="label text-(--i-ink)">{c.label}</span><p className="mt-1">{s.prompt}</p></div>}
                <div className="flex flex-wrap gap-2">{s.tags.map((t) => <span key={t} className="rounded-md border border-(--i-line) bg-(--i-bg) px-2 py-0.5 text-xs text-(--i-ink)">{t}</span>)}</div>
                {s.inCommon.length > 0 && <span className="text-[13px] font-medium text-(--i-ink)">{s.inCommon.length} in common: {s.inCommon.join(', ')}</span>}
                {isOpen && <div className="space-y-2 border-t border-line pt-3"><div><span className="label">About</span><p>{s.bio || '—'}</p></div><div><span className="label">Usually free</span><p>{s.usuallyFree || '—'}</p></div></div>}
                {s.request?.status === 'pending' && s.request.direction === 'received' && <p className="text-[13px] font-medium text-(--i-ink)">{s.name} {c.wants}.</p>}
                <div className="flex gap-2">
                  {!s.request && <button className="btn btn-i flex-1" disabled={connect.isPending} onClick={() => connect.mutate(s.userId)}>{c.cta}</button>}
                  {s.request?.status === 'pending' && s.request.direction === 'sent' && <button disabled className="btn flex-1">{c.sent}</button>}
                  {s.request?.status === 'pending' && s.request.direction === 'received' && <>
                    <button className="btn btn-i flex-1" disabled={answer.isPending} onClick={() => answer.mutate({ id: s.request!.id, status: 'accepted' })}>Accept</button>
                    <button className="btn btn-ghost" disabled={answer.isPending} onClick={() => answer.mutate({ id: s.request!.id, status: 'declined' })}>Not now</button>
                  </>}
                  {s.request?.status === 'accepted' && <Link to="/messages" search={{ intent, with: s.userId }} className="btn btn-i flex-1">Message {s.name}</Link>}
                  {s.request?.status === 'declined' && <button disabled className="btn flex-1">{c.sent}</button>}
                  {!(s.request?.status === 'pending' && s.request.direction === 'received') && <button className="btn btn-ghost" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.userId)}>{isOpen ? 'Less' : 'More'}</button>}
                </div>
                {s.request?.status === 'pending' && s.request.direction === 'sent' && (
                  <p className="text-[13px] text-ink-2">Replies appear in Messages. <Link to="/messages" search={{ intent, with: s.userId }} className="font-semibold text-ink underline underline-offset-2">Write them a message</Link></p>
                )}
                {answer.isError && <p role="alert" className="text-[13px] text-danger">Could not save your answer. Try again.</p>}
                <SafetyMenu userId={s.userId} name={s.name} intent={intent} label={`Block or report ${s.name}`} />
              </div>
            </article>
          )
        })}
        </div>
      </div>
    </div>
  )
}
