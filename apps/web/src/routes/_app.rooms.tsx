import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type Intent } from '~/lib/api'
import { IntentTabs, formatWhen } from '~/components/ui'
import { deptLabel } from '~/lib/dept'
import { LoadingRegion, RoomCardSkeleton, useSkeleton } from '~/components/Skeleton'

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

export const Route = createFileRoute('/_app/rooms')({ component: Rooms })

const KINDS: { id: Intent; label: string }[] = [{ id: 'study', label: 'Study Rooms' }, { id: 'friends', label: 'Hangouts' }]

function Rooms() {
  const [kind, setKind] = useState<'study' | 'friends'>('study')
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['rooms', kind], queryFn: () => unwrap(api.rooms.get({ query: { intent: kind } })) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['rooms'] })
  const request = useMutation({ mutationFn: (id: string) => unwrap(api.rooms({ id }).request.post()), onSuccess: refresh })
  const withdraw = useMutation({ mutationFn: (id: string) => unwrap(api.rooms({ id }).request.delete()), onSuccess: refresh })

  const [creating, setCreating] = useState(false)
  const showSkeleton = useSkeleton(list.isLoading)
  const rooms = list.data?.rooms ?? []
  const live = rooms.filter((r) => r.live)
  const groups = [['Happening now', live], ['Coming up', rooms.filter((r) => !r.live)]] as const

  return (
    <div data-intent={kind} className="flex flex-col gap-5">
      <header className="space-y-2">
        <h1 className="text-[28px] font-bold leading-[34px]">Live rooms on campus</h1>
        <p className="text-ink-2">Sessions at public campus spots. Request a spot and the host approves it.</p>
      </header>
      <IntentTabs value={kind} onChange={(i) => i !== 'romance' && setKind(i)} options={KINDS} />
      <button className={creating ? 'btn btn-ghost' : 'btn btn-i'} onClick={() => setCreating(!creating)}>{creating ? 'Cancel' : kind === 'study' ? 'Host a Study Room' : 'Host a Hangout'}</button>
      {creating && <CreateRoom intent={kind} onDone={() => { setCreating(false); refresh() }} />}
      {list.isError && <p role="alert" className="card text-danger">Could not load rooms.</p>}
      {showSkeleton && <LoadingRegion label="Loading rooms" className="grid gap-3 lg:grid-cols-2">{[0, 1, 2].map((i) => <RoomCardSkeleton key={i} />)}</LoadingRegion>}
      {groups.map(([title, items]) => items.length > 0 && (
        <section key={title} className="space-y-3">
          <h2 className="text-xl font-semibold">{title}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {items.map((r) => {
              const full = r.taken >= r.capacity
              return (
                <article key={r.id} className="card flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md border border-(--i-line) bg-(--i-bg) px-2 py-0.5 text-xs text-(--i-ink)">{r.tag}</span>
                    {r.live && <span className="pill"><i className="dot-live" />Live now</span>}
                    <span className="ml-auto font-mono text-xs text-ink-2">{r.taken}/{r.capacity} spots</span>
                  </div>
                  <div><h3 className="text-[17px] font-semibold">{r.title}</h3><p className="text-[13px] text-ink-2">{r.place} · {formatWhen(r.startsAt)}</p></div>
                  <div role="img" aria-label={`${r.taken} of ${r.capacity} spots taken`} className="h-1.5 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-(--i)" style={{ width: `${(r.taken / r.capacity) * 100}%` }} /></div>
                  <p className="text-[13px] text-ink-2">Hosted by {r.host?.name}</p>
                  {r.isHost ? <HostRequests roomId={r.id} full={full} />
                    : r.myStatus === 'approved' ? <button disabled className="btn">You are in</button>
                    : r.myStatus === 'pending' ? <div className="flex gap-2"><button disabled className="btn flex-1">Pending Host Approval</button><button className="btn btn-ghost" onClick={() => withdraw.mutate(r.id)}>Withdraw</button></div>
                    : full ? <button disabled className="btn">Room Full</button>
                    : <button className="btn btn-i" onClick={() => request.mutate(r.id)}>Request Spot</button>}
                </article>
              )
            })}
          </div>
        </section>
      ))}
      {!list.isLoading && rooms.length === 0 && <p className="card text-ink-2">No rooms yet. Host the first one.</p>}
      <p className="text-[13px] text-ink-2">Rooms are for Study and Friends only. Romance meetups are arranged one to one in Messages.</p>
    </div>
  )
}

function HostRequests({ roomId, full }: { roomId: string; full: boolean }) {
  const qc = useQueryClient()
  const reqs = useQuery({ queryKey: ['rooms', 'requests', roomId], queryFn: () => unwrap(api.rooms({ id: roomId }).requests.get()) })
  const decide = useMutation({
    mutationFn: (v: { userId: string; decision: 'approved' | 'declined' }) => unwrap(api.rooms({ id: roomId }).requests({ userId: v.userId }).post({ decision: v.decision })),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rooms'] }),
  })
  if (!reqs.data?.requests.length) return <p className="text-[13px] text-ink-2">You are hosting. No pending requests.</p>
  return (
    <ul className="space-y-2 border-t border-line pt-3">
      {reqs.data.requests.map((u) => (
        <li key={u.id} className="flex items-center gap-2">
          <span className="flex-1 text-sm"><b>{u.name}</b> <span className="text-ink-2">{u.level}L {deptLabel(u.department)}</span></span>
          <button className="btn btn-i h-10 px-3" disabled={full || decide.isPending} onClick={() => decide.mutate({ userId: u.id, decision: 'approved' })}>Approve</button>
          <button className="btn btn-ghost h-10 px-3" disabled={decide.isPending} onClick={() => decide.mutate({ userId: u.id, decision: 'declined' })}>Decline</button>
        </li>
      ))}
      {full && <li className="text-[13px] text-warn">Room is full. Decline or raise capacity by creating a new room.</li>}
    </ul>
  )
}

function CreateRoom({ intent, onDone }: { intent: 'study' | 'friends'; onDone: () => void }) {
  const spots = useQuery({ queryKey: ['spots'], queryFn: () => unwrap(api.spots.get()), staleTime: Infinity })
  const [tag, setTag] = useState(''); const [title, setTitle] = useState(''); const [place, setPlace] = useState('')
  const [start, setStart] = useState(toLocalInput(new Date())); const [mins, setMins] = useState(90); const [capacity, setCapacity] = useState(5)
  const create = useMutation({
    mutationFn: () => {
      const startsAt = new Date(start)
      return unwrap(api.rooms.post({ intent, tag, title, place, startsAt: startsAt.toISOString(), endsAt: new Date(+startsAt + mins * 60_000).toISOString(), capacity }))
    },
    onSuccess: onDone,
  })
  const ok = tag.trim() && title.trim() && place
  return (
    <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); ok && create.mutate() }}>
      <span className="label">New {intent === 'study' ? 'study room' : 'hangout'}</span>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">Tag<input className="input mt-2 font-normal" maxLength={24} value={tag} onChange={(e) => setTag(e.target.value)} placeholder={intent === 'study' ? 'CSS 411' : 'Football'} /></label>
        <label className="text-sm font-semibold">Spots<input className="input mt-2 font-normal" type="number" min={2} max={50} value={capacity} onChange={(e) => setCapacity(+e.target.value)} /></label>
      </div>
      <label className="block text-sm font-semibold">Title<input className="input mt-2 font-normal" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="block text-sm font-semibold">Public campus spot
        <select className="input mt-2 font-normal" value={place} onChange={(e) => setPlace(e.target.value)}><option value="">Choose a spot</option>{spots.data?.spots.map((s) => <option key={s}>{s}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">Starts<input className="input mt-2 font-normal" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="text-sm font-semibold">Length<select className="input mt-2 font-normal" value={mins} onChange={(e) => setMins(+e.target.value)}>{[30, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
      </div>
      {create.isError && <p role="alert" className="text-sm text-danger">Could not create the room. Check the time and spot.</p>}
      <button className="btn btn-i w-full" disabled={!ok || create.isPending}>Create Room</button>
    </form>
  )
}
