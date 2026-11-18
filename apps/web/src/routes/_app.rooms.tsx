import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type Intent } from '~/lib/api'
import { IntentTabs, formatWhen } from '~/components/ui'
import { deptLabel } from '~/lib/dept'
import { LoadingRegion, RoomCardSkeleton, useSkeleton } from '~/components/Skeleton'

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

export const Route = createFileRoute('/_app/rooms')({ component: Rooms })

// What went wrong, in words a student can act on. Anything unexpected falls back to a general line.
const PROBLEMS: Record<string, string> = {
  room_full: 'This room is full. Raise the number of spots first, or decline.',
  cancelled: 'This room was cancelled.',
  not_found: 'That room or request is no longer available. The list has been refreshed.',
  host_only: 'Only the host can do that.',
  bad_time_range: 'The end must be after the start, and still in the future.',
  capacity_below_members: 'More people than that already have a place. Choose a higher number of spots.',
}
export const problemText = (e: unknown) => PROBLEMS[(e as { value?: { error?: string } })?.value?.error ?? ''] ?? 'Something went wrong. Check your connection and try again.'

const KINDS: { id: Intent; label: string }[] = [{ id: 'study', label: 'Study Rooms' }, { id: 'friends', label: 'Hangouts' }]

function Rooms() {
  const [kind, setKind] = useState<'study' | 'friends'>('study')
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['rooms', kind], queryFn: () => unwrap(api.rooms.get({ query: { intent: kind } })) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['rooms'] }); qc.invalidateQueries({ queryKey: ['unread'] }) }
  const [problem, setProblem] = useState<string | null>(null)
  const fail = (e: unknown) => { setProblem(problemText(e)); refresh() }
  const request = useMutation({ mutationFn: (id: string) => unwrap(api.rooms({ id }).request.post()), onSuccess: () => { setProblem(null); refresh() }, onError: fail })
  const withdraw = useMutation({ mutationFn: (id: string) => unwrap(api.rooms({ id }).request.delete()), onSuccess: () => { setProblem(null); refresh() }, onError: fail })
  const cancelRoom = useMutation({ mutationFn: (id: string) => unwrap(api.rooms({ id }).delete()), onSuccess: () => { setProblem(null); setConfirming(null); refresh() }, onError: fail })

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null) // room whose "cancel it?" question is open
  const showSkeleton = useSkeleton(list.isLoading)
  const rooms = list.data?.rooms ?? []
  const groups = [
    ['Happening now', rooms.filter((r) => r.live && !r.cancelled)],
    ['Coming up', rooms.filter((r) => !r.live && !r.cancelled)],
    ['Cancelled', rooms.filter((r) => r.cancelled)],
  ] as const

  // Answers and cancellations are news until you have looked. Remember which rooms were new on arrival (so they can be
  // highlighted), then tell the server you have seen them so the Rooms badge clears.
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const seen = useMutation({ mutationFn: () => unwrap(api.rooms.seen.post()), onSuccess: () => qc.invalidateQueries({ queryKey: ['unread'] }) })
  useEffect(() => {
    const unseen = rooms.filter((r) => r.decisionUnseen)
    if (unseen.length === 0 || document.visibilityState !== 'visible') return
    setFresh((f) => new Set([...f, ...unseen.map((r) => r.id)]))
    seen.mutate()
  }, [list.data]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div data-intent={kind} className="flex flex-col gap-5">
      <header className="space-y-2">
        <h1 className="text-[28px] font-bold leading-[34px]">Live rooms on campus</h1>
        <p className="text-ink-2">Sessions at public campus spots. Request a spot and the host approves it.</p>
      </header>
      <IntentTabs value={kind} onChange={(i) => i !== 'romance' && setKind(i)} options={KINDS} label="Kind of room" />
      <button className={creating ? 'btn btn-ghost' : 'btn btn-i'} onClick={() => setCreating(!creating)}>{creating ? 'Cancel' : kind === 'study' ? 'Host a Study Room' : 'Host a Hangout'}</button>
      {creating && <RoomForm intent={kind} onDone={() => { setCreating(false); refresh() }} />}
      {problem && <p role="alert" className="card text-danger">{problem}</p>}
      {list.isError && <p role="alert" className="card text-danger">Could not load rooms.</p>}
      {showSkeleton && <LoadingRegion label="Loading rooms" className="grid gap-3 lg:grid-cols-2">{[0, 1, 2].map((i) => <RoomCardSkeleton key={i} />)}</LoadingRegion>}
      {groups.map(([title, items]) => items.length > 0 && (
        <section key={title} className="space-y-3">
          <h2 className="text-xl font-semibold">{title}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {items.map((r) => {
              const full = r.taken >= r.capacity
              return (
                <article key={r.id} className={`card flex flex-col gap-3 ${r.cancelled ? 'opacity-80' : ''}`}>
                  <div className="flex items-center gap-2">
                    {fresh.has(r.id) && <span className="rounded-full bg-(--i-ink) px-2 py-0.5 text-[11px] font-semibold text-white">New</span>}
                    <span className="rounded-md border border-(--i-line) bg-(--i-bg) px-2 py-0.5 text-xs text-(--i-ink)">{r.tag}</span>
                    {r.live && <span className="pill"><i className="dot-live" />Live now</span>}
                    <span className="ml-auto font-mono text-xs text-ink-2">{r.taken}/{r.capacity} spots</span>
                  </div>
                  <div><h3 className="text-[17px] font-semibold">{r.title}</h3><p className="text-[13px] text-ink-2">{r.place} · {formatWhen(r.startsAt)}</p></div>
                  <div role="img" aria-label={`${r.taken} of ${r.capacity} spots taken`} className="h-1.5 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-(--i)" style={{ width: `${(r.taken / r.capacity) * 100}%` }} /></div>
                  <p className="text-[13px] text-ink-2">Hosted by {r.host?.name}</p>
                  {r.cancelled ? <p role="status" className="rounded-[10px] bg-subtle p-3 text-sm text-ink-2">Cancelled by the host. {r.myStatus === 'approved' ? 'Your place is released.' : 'Your request is closed.'}</p>
                    : r.isHost ? (
                      <div className="space-y-3">
                        <HostRequests roomId={r.id} full={full} onError={fail} />
                        {confirming === r.id ? (
                          <div className="space-y-2 rounded-[10px] border border-line p-3 text-sm">
                            <p>Cancel this room? Everyone with a place, and everyone waiting, is told.</p>
                            <div className="flex gap-2"><button className="btn btn-danger h-10 px-3" disabled={cancelRoom.isPending} onClick={() => cancelRoom.mutate(r.id)}>{cancelRoom.isPending ? 'Cancelling…' : 'Cancel the room'}</button><button autoFocus className="btn btn-ghost h-10 px-3" onClick={() => { setConfirming(null); setTimeout(() => document.querySelector<HTMLElement>(`[data-cancel-room="${r.id}"]`)?.focus(), 0) }}>Keep it</button></div>
                          </div>
                        ) : (
                          <div className="flex gap-2"><button aria-expanded={editing === r.id} className="btn btn-ghost h-10 px-3" onClick={() => { setEditing(editing === r.id ? null : r.id); setCreating(false) }}>{editing === r.id ? 'Close editor' : 'Edit'}</button><button data-cancel-room={r.id} className="btn btn-ghost h-10 px-3" onClick={() => setConfirming(r.id)}>Cancel room</button></div>
                        )}
                        {editing === r.id && <RoomForm intent={kind} room={r} onDone={() => { setEditing(null); refresh() }} />}
                      </div>)
                    : r.myStatus === 'approved' ? <button disabled className="btn">You are in</button>
                    : r.myStatus === 'declined' ? <button disabled className="btn">Not approved this time</button>
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

function HostRequests({ roomId, full, onError }: { roomId: string; full: boolean; onError: (e: unknown) => void }) {
  const qc = useQueryClient()
  const reqs = useQuery({ queryKey: ['rooms', 'requests', roomId], queryFn: () => unwrap(api.rooms({ id: roomId }).requests.get()) })
  const decide = useMutation({
    mutationFn: (v: { userId: string; decision: 'approved' | 'declined' }) => unwrap(api.rooms({ id: roomId }).requests({ userId: v.userId }).post({ decision: v.decision })),
    onError,
    onSettled: () => { qc.invalidateQueries({ queryKey: ['rooms'] }); qc.invalidateQueries({ queryKey: ['unread'] }) },
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
      {full && <li className="text-[13px] text-warn-ink">Room is full. Decline or raise capacity by creating a new room.</li>}
    </ul>
  )
}

type RoomRow = { id: string; tag: string; title: string; place: string; startsAt: string | Date; endsAt: string | Date; capacity: number; taken: number }

/** One form for hosting a new room and for editing yours. Editing keeps people's places; spots cannot drop below who is already in. */
function RoomForm({ intent, room, onDone }: { intent: 'study' | 'friends'; room?: RoomRow; onDone: () => void }) {
  const spots = useQuery({ queryKey: ['spots'], queryFn: () => unwrap(api.spots.get()), staleTime: Infinity })
  const length0 = room ? Math.max(15, Math.round((+new Date(room.endsAt) - +new Date(room.startsAt)) / 60_000)) : 90
  const [tag, setTag] = useState(room?.tag ?? ''); const [title, setTitle] = useState(room?.title ?? ''); const [place, setPlace] = useState(room?.place ?? '')
  const [start, setStart] = useState(toLocalInput(room ? new Date(room.startsAt) : new Date())); const [mins, setMins] = useState(length0); const [capacity, setCapacity] = useState(room?.capacity ?? 5)
  const lengths = [...new Set([30, 60, 90, 120, 180, length0])].sort((a, b) => a - b)
  const placeOptions = [...new Set([...(room ? [room.place] : []), ...(spots.data?.spots ?? [])])] // keep your current spot even if staff retired it
  const save = useMutation({
    mutationFn: () => {
      const startsAt = new Date(start)
      const body = { tag, title, place, startsAt: startsAt.toISOString(), endsAt: new Date(+startsAt + mins * 60_000).toISOString(), capacity }
      return room ? unwrap(api.rooms({ id: room.id }).patch(body)) : unwrap(api.rooms.post({ intent, ...body }))
    },
    onSuccess: onDone,
  })
  const minSpots = Math.max(room?.taken ?? 0, 2)
  const ok = tag.trim() && title.trim() && place && capacity >= minSpots
  return (
    <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); ok && save.mutate() }}>
      <span className="label">{room ? 'Edit this room' : `New ${intent === 'study' ? 'study room' : 'hangout'}`}</span>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">Tag<input className="input mt-2 font-normal" maxLength={24} value={tag} onChange={(e) => setTag(e.target.value)} placeholder={intent === 'study' ? 'CSS 411' : 'Football'} /></label>
        <label className="text-sm font-semibold">Spots<input className="input mt-2 font-normal" type="number" min={minSpots} max={50} value={capacity} onChange={(e) => setCapacity(+e.target.value)} /></label>
      </div>
      {room && room.taken > 1 && <p className="text-xs text-ink-2">{room.taken} people already have a place, so spots cannot go below {room.taken}. They are told about any change.</p>}
      <label className="block text-sm font-semibold">Title<input className="input mt-2 font-normal" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="block text-sm font-semibold">Public campus spot
        <select className="input mt-2 font-normal" value={place} onChange={(e) => setPlace(e.target.value)}><option value="">Choose a spot</option>{placeOptions.map((s) => <option key={s}>{s}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">Starts<input className="input mt-2 font-normal" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="text-sm font-semibold">Length<select className="input mt-2 font-normal" value={mins} onChange={(e) => setMins(+e.target.value)}>{lengths.map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
      </div>
      {save.isError && <p role="alert" className="text-sm text-danger">{problemText(save.error)}</p>}
      <button className="btn btn-i w-full" disabled={!ok || save.isPending}>{save.isPending ? 'Saving…' : room ? 'Save changes' : 'Create Room'}</button>
    </form>
  )
}
