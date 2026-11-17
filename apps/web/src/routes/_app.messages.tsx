import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, INTENTS, type Intent } from '~/lib/api'
import { IntentTabs, formatWhen } from '~/components/ui'
import { deptLabel } from '~/lib/dept'
import { Avatar } from '~/components/Avatar'
import { BubblesSkeleton, ConversationChipsSkeleton, ConversationSkeleton, LoadingRegion, useSkeleton } from '~/components/Skeleton'
import { SafetyMenu } from '~/components/safety'

// ?intent=&with= lets Discover open the right chat directly.
export const Route = createFileRoute('/_app/messages')({
  validateSearch: (s: Record<string, unknown>): { intent?: Intent; with?: string } => ({
    intent: INTENTS.some((i) => i.id === s.intent) ? (s.intent as Intent) : undefined,
    with: typeof s.with === 'string' ? s.with : undefined,
  }),
  component: Messages,
})

const INVITED: Record<Intent, string> = { study: 'invited you to study together', friends: 'said hi', romance: 'sent you a Spark' }
const SEND_ERRORS: Record<string, string> = {
  waiting_for_reply: 'Waiting for a reply. You can write more once they accept.',
  conversation_closed: 'This conversation is closed.',
  time_in_past: 'Pick a time in the future.',
  public_campus_spot_required: 'Pick one of the public campus spots.',
}

const NOTE: Record<Intent, string> = {
  study: 'Study chats stay in Study. Nothing here appears in Friends or Romance.',
  friends: 'Friends chats stay in Friends. Nothing here appears in Study or Romance.',
  romance: 'Romance chats stay in Romance. Nothing here appears in Study or Friends.',
}

function Messages() {
  const { me } = Route.useRouteContext()
  const search = Route.useSearch()
  const enabledModes = INTENTS.filter((i) => me.profiles.some((p) => p.intent === i.id && p.enabled))
  const [intent, setIntent] = useState<Intent>(search.intent ?? enabledModes[0]?.id ?? 'study')
  const [active, setActive] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [composing, setComposing] = useState(false)
  const [spot, setSpot] = useState('')
  const [when, setWhen] = useState('')
  const qc = useQueryClient()

  const convos = useQuery({ queryKey: ['conversations', intent], queryFn: () => unwrap(api.conversations.get({ query: { intent } })) })
  const spots = useQuery({ queryKey: ['spots'], queryFn: () => unwrap(api.spots.get()), staleTime: Infinity })
  const list = convos.data?.conversations ?? []
  const showSkeleton = useSkeleton(convos.isLoading)
  // Open the chat you chose, or the one from Discover, or the first one that is waiting on you.
  const needsYou = (c: (typeof list)[number]) => c.unread > 0 || (c.request?.status === 'pending' && c.request.direction === 'received')
  const current = list.find((c) => c.id === active[intent])
    ?? (search.with && search.intent === intent ? list.find((c) => c.with.id === search.with) : undefined)
    ?? list.find(needsYou) ?? list[0]
  const unreadAll = useQuery({ queryKey: ['unread'], queryFn: () => unwrap(api.me.unread.get()) })
  const msgs = useQuery({
    queryKey: ['messages', current?.id], enabled: !!current,
    queryFn: () => unwrap(api.conversations({ id: current!.id }).messages.get()),
  })
  const invited = current?.request?.status === 'pending' && current.request.direction === 'received'
  const closed = current?.request?.status === 'declined'
  const iWrote = !!msgs.data?.messages.some((m) => m.senderId === me.user.id)
  const waitingOnThem = current?.request?.status === 'pending' && current.request.direction === 'sent' && iWrote
  const [sendError, setSendError] = useState<string | null>(null)
  // A draft belongs to one conversation: switching must never carry it to someone else.
  useEffect(() => { setDraft(''); setComposing(false); setSendError(null) }, [current?.id])
  // Opening a conversation (with the tab in view) marks it read, so the badges clear.
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible')
  useEffect(() => { const f = () => setVisible(document.visibilityState === 'visible'); document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f) }, [])
  const markRead = useMutation({
    mutationFn: (id: string) => unwrap(api.conversations({ id }).read.post()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conversations'] }); qc.invalidateQueries({ queryKey: ['unread'] }) },
  })
  useEffect(() => { if (current && current.unread > 0 && msgs.data && visible && !markRead.isPending) markRead.mutate(current.id) }, [current?.id, current?.unread, msgs.data, visible]) // eslint-disable-line react-hooks/exhaustive-deps
  const reply = useMutation({
    mutationFn: (v: { id: string; status: 'accepted' | 'declined' }) => unwrap(api.connections({ id: v.id }).patch({ status: v.status })),
    onSuccess: () => { for (const k of ['conversations', 'unread', 'discover']) qc.invalidateQueries({ queryKey: [k] }) },
  })
  const done = () => { qc.invalidateQueries({ queryKey: ['messages', current?.id] }); qc.invalidateQueries({ queryKey: ['conversations'] }) }
  const sendText = useMutation({ mutationFn: () => unwrap(api.conversations({ id: current!.id }).messages.post({ kind: 'text', body: draft })), onSuccess: () => { setDraft(''); setSendError(null); done() }, onError: (e: { value?: { error?: string } }) => setSendError(SEND_ERRORS[e.value?.error ?? ''] ?? 'Could not send. Try again.') })
  const propose = useMutation({
    mutationFn: () => unwrap(api.conversations({ id: current!.id }).messages.post({ kind: 'meetup', where: spot, when: new Date(when).toISOString() })),
    onSuccess: () => { setComposing(false); setSpot(''); setWhen(''); setSendError(null); done() },
    onError: (e: { value?: { error?: string } }) => setSendError(SEND_ERRORS[e.value?.error ?? ''] ?? 'Could not send. Try again.'),
  })
  const answer = useMutation({ mutationFn: (v: { id: string; status: 'confirmed' | 'declined' }) => unwrap(api.messages({ id: v.id }).meetup.patch({ status: v.status })), onSuccess: done })

  const enabled = INTENTS.filter((i) => me.profiles.some((p) => p.intent === i.id && p.enabled))
  return (
    <div data-intent={intent} className="flex flex-col gap-4">
      <IntentTabs value={intent} onChange={(i) => { setIntent(i); setComposing(false) }} options={enabled} alerts={unreadAll.data?.byIntent} />
      <p className="rounded-[10px] bg-(--i-bg) p-3 text-[13px] text-ink">{NOTE[intent]}</p>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {showSkeleton && <LoadingRegion label="Loading conversations"><ConversationChipsSkeleton /></LoadingRegion>}
        {list.map((c) => <button key={c.id} className="chip" aria-pressed={current?.id === c.id} onClick={() => setActive({ ...active, [intent]: c.id })}>{c.with.name}{needsYou(c) && <span className="ml-1.5 min-w-5 rounded-full bg-(--i-ink) px-1.5 text-center font-mono text-[11px] leading-5 text-white"><span className="sr-only"> waiting</span><span aria-hidden>{c.unread || 'New'}</span></span>}</button>)}
      </div>
      {showSkeleton && <ConversationSkeleton />}
      {!current && !convos.isLoading && <p className="card text-ink-2">No {intent} conversations yet. Reach out from Discover.</p>}

      {current && (
        <section className="card flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3"><Avatar name={current.with.name} photoId={current.photoId} /><h2 className="text-[17px] font-semibold">{current.with.name} • {current.with.level}L {deptLabel(current.with.department)}</h2></div>
            <SafetyMenu userId={current.with.id} name={current.with.name} intent={intent} label="Block or report" />
          </div>
          {invited && current && (
            <div role="status" className="space-y-2 rounded-[12px] border border-(--i-line) bg-(--i-bg) p-3">
              <p><b>{current.with.name}</b> {INVITED[intent]}. Accept to start chatting.</p>
              <div className="flex gap-2">
                <button className="btn btn-i h-10" disabled={reply.isPending} onClick={() => reply.mutate({ id: current.request!.id, status: 'accepted' })}>Accept</button>
                <button className="btn btn-ghost h-10" disabled={reply.isPending} onClick={() => reply.mutate({ id: current.request!.id, status: 'declined' })}>Not now</button>
              </div>
              {reply.isError && <p role="alert" className="text-sm text-danger">Could not save your answer. Try again.</p>}
            </div>
          )}
          {msgs.isLoading && <LoadingRegion label="Loading messages"><BubblesSkeleton /></LoadingRegion>}
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
          {closed ? <p className="rounded-[10px] bg-subtle p-3 text-sm text-ink-2">This conversation is closed.</p>
          : waitingOnThem ? <p className="rounded-[10px] bg-subtle p-3 text-sm text-ink-2">Waiting for {current.with.name} to reply. You can write more once they accept.</p>
          : composing ? (
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
          {current.request?.status === 'pending' && current.request.direction === 'sent' && !iWrote && <p className="text-[13px] text-ink-2">Your first message goes with your invite. {current.with.name} replies here once they accept.</p>}
          {sendError && <p role="alert" className="text-sm text-danger">{sendError}</p>}
        </section>
      )}
    </div>
  )
}
