import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, INTENTS, type Intent } from '~/lib/api'
import { IntentTabs, formatWhen } from '~/components/ui'
import { deptLabel } from '~/lib/dept'
import { SafetyMenu } from '~/components/safety'

export const Route = createFileRoute('/_app/messages')({ component: Messages })

const NOTE: Record<Intent, string> = {
  study: 'Study chats stay in Study. Nothing here appears in Friends or Romance.',
  friends: 'Friends chats stay in Friends. Nothing here appears in Study or Romance.',
  romance: 'Romance chats stay in Romance. Nothing here appears in Study or Friends.',
}

function Messages() {
  const { me } = Route.useRouteContext()
  const [intent, setIntent] = useState<Intent>('study')
  const [active, setActive] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [composing, setComposing] = useState(false)
  const [spot, setSpot] = useState('')
  const [when, setWhen] = useState('')
  const qc = useQueryClient()

  const convos = useQuery({ queryKey: ['conversations', intent], queryFn: () => unwrap(api.conversations.get({ query: { intent } })) })
  const spots = useQuery({ queryKey: ['spots'], queryFn: () => unwrap(api.spots.get()), staleTime: Infinity })
  const list = convos.data?.conversations ?? []
  const current = list.find((c) => c.id === active[intent]) ?? list[0]
  const msgs = useQuery({
    queryKey: ['messages', current?.id], enabled: !!current,
    queryFn: () => unwrap(api.conversations({ id: current!.id }).messages.get()),
  })
  const done = () => { qc.invalidateQueries({ queryKey: ['messages', current?.id] }); qc.invalidateQueries({ queryKey: ['conversations'] }) }
  const sendText = useMutation({ mutationFn: () => unwrap(api.conversations({ id: current!.id }).messages.post({ kind: 'text', body: draft })), onSuccess: () => { setDraft(''); done() } })
  const propose = useMutation({
    mutationFn: () => unwrap(api.conversations({ id: current!.id }).messages.post({ kind: 'meetup', where: spot, when: new Date(when).toISOString() })),
    onSuccess: () => { setComposing(false); setSpot(''); setWhen(''); done() },
  })
  const answer = useMutation({ mutationFn: (v: { id: string; status: 'confirmed' | 'declined' }) => unwrap(api.messages({ id: v.id }).meetup.patch({ status: v.status })), onSuccess: done })

  const enabled = INTENTS.filter((i) => me.profiles.some((p) => p.intent === i.id && p.enabled))
  return (
    <div data-intent={intent} className="flex flex-col gap-4">
      <IntentTabs value={intent} onChange={(i) => { setIntent(i); setComposing(false) }} options={enabled} />
      <p className="rounded-[10px] bg-(--i-bg) p-3 text-[13px] text-ink">{NOTE[intent]}</p>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {list.map((c) => <button key={c.id} className="chip" aria-pressed={current?.id === c.id} onClick={() => setActive({ ...active, [intent]: c.id })}>{c.with.name}</button>)}
      </div>
      {!current && <p className="card text-ink-2">No {intent} conversations yet. Reach out from Discover.</p>}

      {current && (
        <section className="card flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-[17px] font-semibold">{current.with.name} • {current.with.level}L {deptLabel(current.with.department)}</h2>
            <SafetyMenu userId={current.with.id} name={current.with.name} intent={intent} label="Block or report" />
          </div>
          <ol className="flex flex-col gap-2">
            {msgs.data?.messages.map((m) => {
              const mine = m.senderId === me.user.id
              if (m.kind === 'text') return (
                <li key={m.id} className={`flex max-w-[85%] flex-col gap-1 ${mine ? 'self-end items-end' : 'self-start items-start'}`}>
                  <span className={`rounded-2xl border px-3 py-2 ${mine ? 'border-(--i-ink) bg-(--i-ink) text-white' : 'border-(--i-line) bg-surface'}`}>{m.body}</span>
                  {!mine && <SafetyMenu userId={current.with.id} name={current.with.name} intent={intent} messageId={m.id} label="Report this message" />}
                </li>
              )
              return (
                <li key={m.id} className="rounded-[12px] border border-(--i-line) bg-(--i-bg) p-3">
                  <span className="label text-(--i-ink)">Meetup proposal</span>
                  <p className="font-semibold">{m.meetupWhere} · {m.meetupWhen && formatWhen(m.meetupWhen)}</p>
                  {m.meetupStatus === 'confirmed' && <p className="text-sm font-medium text-live">Confirmed</p>}
                  {m.meetupStatus === 'declined' && <p className="text-sm text-ink-2">Declined</p>}
                  {m.meetupStatus === 'pending' && (mine ? <p className="text-sm text-ink-2">Waiting for {current.with.name}</p> :
                    <div className="mt-2 flex gap-2"><button className="btn btn-i h-10" onClick={() => answer.mutate({ id: m.id, status: 'confirmed' })}>Accept</button><button className="btn btn-ghost h-10" onClick={() => answer.mutate({ id: m.id, status: 'declined' })}>Decline</button></div>)}
                </li>
              )
            })}
          </ol>
          {composing ? (
            <div className="space-y-3 rounded-[12px] border border-line p-3">
              <span className="label">Propose a public campus spot</span>
              <div className="flex flex-wrap gap-2">{spots.data?.spots.map((s) => <button key={s} className="chip" aria-pressed={spot === s} onClick={() => setSpot(s)}>{s}</button>)}</div>
              <input type="datetime-local" className="input" aria-label="When" value={when} onChange={(e) => setWhen(e.target.value)} />
              <div className="flex gap-2"><button className="btn btn-i flex-1" disabled={!spot || !when || propose.isPending} onClick={() => propose.mutate()}>Send Proposal</button><button className="btn btn-ghost" onClick={() => setComposing(false)}>Cancel</button></div>
            </div>
          ) : (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); draft.trim() && sendText.mutate() }}>
              <input className="input" placeholder={`Message ${current.with.name}`} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button className="btn btn-i" disabled={!draft.trim()}>Send</button>
              <button type="button" className="btn btn-ghost" onClick={() => setComposing(true)}>Meet</button>
            </form>
          )}
        </section>
      )}
    </div>
  )
}
