import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { DisconnectReason, MediaDeviceFailure, Room, RoomEvent, Track, type Participant } from 'livekit-client'
import { api, unwrap } from '~/lib/api'
import { blockedAmong } from '~/lib/voice'
import { BlockedPresentDialog } from './BlockedPresentDialog'

type Phase =
  | { kind: 'joining' }
  | { kind: 'blocked'; people: { name: string }[] }
  | { kind: 'in' }
  | { kind: 'ended' }
  | { kind: 'removed' }
  | { kind: 'dropped' }
  | { kind: 'failed'; message: string }
type Mic = 'starting' | 'on' | 'muted' | 'blocked' | 'unavailable'
type Message = { id: number; from: string; text: string; mine: boolean }
type ApiError = { status?: number; value?: { error?: string; people?: { name: string }[] } }

const CHAT_TOPIC = 'chat'
const MAX_MESSAGE = 500
const MAX_KEPT = 200 // only the latest messages stay on screen; none are ever saved anywhere
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * The live voice call of an online room: microphone only, a list of who is here and who is speaking, and a text box whose
 * messages go straight to the people in the call at that moment (nothing is stored, and you only see what was said after
 * you joined). The only way in is the join route, which checks your place and asks first if someone you blocked is here.
 */
export function VoiceRoom({ roomId, title, endsAt, isHost = false, problemText, onLeave }: {
  roomId: string; title: string
  /** When the room ends: the call leaves by itself then. */
  endsAt: string
  /** The host may remove people from the call. */
  isHost?: boolean
  /** Turns an API error into words (the Rooms page's texts). */
  problemText: (e: unknown) => string
  onLeave: () => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'joining' })
  const [mic, setMic] = useState<Mic>('starting')
  const [reconnecting, setReconnecting] = useState(false)
  const [soundBlocked, setSoundBlocked] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sendFailed, setSendFailed] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set()) // blocked people you chose to stay with
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)

  const roomRef = useRef<Room | null>(null)
  const run = useRef(0) // each join attempt has a number; a newer attempt (or leaving) makes older ones stand down
  const seq = useRef(0)
  const audioBox = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  const blocks = useQuery({ queryKey: ['blocks'], queryFn: () => unwrap(api.blocks.get()) })
  const blockedIds = useMemo(() => new Set((blocks.data?.blocked ?? []).map((b) => b.id)), [blocks.data])
  const blockedRef = useRef(blockedIds)
  blockedRef.current = blockedIds

  const hangUp = () => {
    const r = roomRef.current
    roomRef.current = null
    run.current++
    if (r) void r.disconnect()
  }

  async function enableMic(room: Room) {
    setMic('starting')
    try {
      await room.localParticipant.setMicrophoneEnabled(true)
      if (roomRef.current === room) setMic('on')
    } catch (e) {
      if (roomRef.current === room) setMic(MediaDeviceFailure.getFailure(e) === MediaDeviceFailure.PermissionDenied ? 'blocked' : 'unavailable')
    }
  }

  async function join(acknowledgeBlocked: boolean) {
    hangUp()
    const mine = ++run.current
    setPhase({ kind: 'joining' }); setReconnecting(false); setMessages([]); setConfirmRemove(null)
    let creds: { url: string; token: string }
    try {
      creds = await unwrap(api.rooms({ id: roomId }).join.post({ acknowledgeBlocked }))
    } catch (e) {
      if (mine !== run.current) return
      const v = (e as ApiError).value
      if (v?.error === 'blocked_present') return setPhase({ kind: 'blocked', people: v.people ?? [] })
      if (v?.error === 'ended' || v?.error === 'cancelled') return setPhase({ kind: 'ended' })
      return setPhase({ kind: 'failed', message: problemText(e) })
    }
    if (mine !== run.current) return

    const room = new Room({ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    roomRef.current = room
    room
      .on(RoomEvent.ParticipantConnected, bump).on(RoomEvent.ParticipantDisconnected, bump).on(RoomEvent.ParticipantNameChanged, bump)
      .on(RoomEvent.ActiveSpeakersChanged, bump).on(RoomEvent.TrackMuted, bump).on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.LocalTrackPublished, bump).on(RoomEvent.LocalTrackUnpublished, bump)
      .on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Audio) audioBox.current?.appendChild(track.attach()); bump() })
      .on(RoomEvent.TrackUnsubscribed, (track) => { track.detach().forEach((el) => el.remove()); bump() })
      .on(RoomEvent.SignalReconnecting, () => setReconnecting(true)).on(RoomEvent.Reconnecting, () => setReconnecting(true))
      .on(RoomEvent.Reconnected, () => setReconnecting(false))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setSoundBlocked(!room.canPlaybackAudio))
      .on(RoomEvent.MediaDevicesError, (e) => setMic(MediaDeviceFailure.getFailure(e) === MediaDeviceFailure.PermissionDenied ? 'blocked' : 'unavailable'))
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (topic !== CHAT_TOPIC || !participant) return
        let text: unknown
        try { text = JSON.parse(decoder.decode(payload)).text } catch { return }
        if (typeof text !== 'string' || !text.trim()) return
        const from = participant.name || 'Someone'
        setMessages((ms) => [...ms.slice(-(MAX_KEPT - 1)), { id: ++seq.current, from, text: text.slice(0, MAX_MESSAGE), mine: false }])
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (roomRef.current !== room) return // we hung up ourselves
        roomRef.current = null
        audioBox.current?.replaceChildren()
        setReconnecting(false)
        setPhase(reason === DisconnectReason.ROOM_DELETED ? { kind: 'ended' } : reason === DisconnectReason.PARTICIPANT_REMOVED ? { kind: 'removed' } : { kind: 'dropped' })
      })

    try {
      await room.connect(creds.url, creds.token)
    } catch {
      if (mine !== run.current) return
      roomRef.current = null
      return setPhase({ kind: 'failed', message: 'Could not connect to the call. Check your connection and try again.' })
    }
    if (mine !== run.current) { void room.disconnect(); return }
    // You already said yes to the people you blocked who were here when you joined: the banner is for anyone who comes later.
    if (acknowledgeBlocked) setDismissed(new Set(blockedAmong([...room.remoteParticipants.values()].map((p) => p.identity), blockedRef.current)))
    setSoundBlocked(!room.canPlaybackAudio)
    setPhase({ kind: 'in' })
    await enableMic(room)
  }

  useEffect(() => {
    void join(false)
    heading.current?.focus()
    return () => { hangUp(); audioBox.current?.replaceChildren() } // eslint-disable-line react-hooks/exhaustive-deps
  }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  // The room ends at its end time: leave the call then, whatever state it is in.
  useEffect(() => {
    const t = setTimeout(() => { hangUp(); audioBox.current?.replaceChildren(); setPhase({ kind: 'ended' }) }, Math.max(0, new Date(endsAt).getTime() - Date.now()))
    return () => clearTimeout(t)
  }, [endsAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => { hangUp(); onLeave() }

  const toggleMic = async () => {
    const room = roomRef.current
    if (!room) return
    if (mic === 'on') {
      try { await room.localParticipant.setMicrophoneEnabled(false); setMic('muted') } catch { /* stays on; the button still says Mute */ }
    } else await enableMic(room)
  }

  const send = async () => {
    const room = roomRef.current
    const text = draft.trim().slice(0, MAX_MESSAGE)
    if (!room || !text) return
    try {
      await room.localParticipant.publishData(encoder.encode(JSON.stringify({ text })), { reliable: true, topic: CHAT_TOPIC })
      setMessages((ms) => [...ms.slice(-(MAX_KEPT - 1)), { id: ++seq.current, from: 'You', text, mine: true }])
      setDraft(''); setSendFailed(false)
    } catch { setSendFailed(true) }
  }

  const remove = useMutation({
    mutationFn: (p: { id: string; name: string }) => unwrap(api.rooms({ id: roomId }).members({ userId: p.id }).remove.post()),
    onSuccess: () => setConfirmRemove(null),
  })
  const removeError = (() => {
    const e = remove.error as ApiError | null
    if (!e || !remove.variables) return null
    if (e.status === 502 || e.value?.error === 'voice_unavailable') return `${remove.variables.name} can no longer join, but we could not disconnect them from the call yet. Try again.`
    return problemText(e)
  })()

  const room = roomRef.current
  const people: Participant[] = room && phase.kind === 'in' ? [room.localParticipant, ...room.remoteParticipants.values()] : []
  const newBlocked = blockedAmong(people.slice(1).map((p) => p.identity), blockedIds).filter((id) => !dismissed.has(id))

  return (
    <section aria-labelledby="voice-heading" className="card space-y-4">
      <div ref={audioBox} hidden />
      <div className="flex items-center gap-2">
        <h2 ref={heading} tabIndex={-1} id="voice-heading" className="flex-1 text-[17px] font-semibold outline-none">Voice call: {title}</h2>
        {phase.kind === 'in' && <span className="pill"><i className="dot-live" />In the call</span>}
      </div>

      {phase.kind === 'joining' && <p role="status" className="text-sm text-ink-2">Joining the call…</p>}

      {phase.kind === 'blocked' && (
        <>
          <p role="status" className="text-sm text-ink-2">Waiting for your answer…</p>
          <BlockedPresentDialog people={phase.people} onJoin={() => void join(true)} onCancel={leave} />
        </>
      )}

      {(phase.kind === 'ended' || phase.kind === 'removed' || phase.kind === 'dropped' || phase.kind === 'failed') && (
        <div className="space-y-3">
          <p role="alert" className="rounded-[10px] bg-subtle p-3 text-sm">
            {phase.kind === 'ended' ? 'This room has ended.' : phase.kind === 'removed' ? 'The host removed you from this call.' : phase.kind === 'dropped' ? 'You were disconnected from the call.' : phase.message}
          </p>
          <div className="flex gap-2">
            {(phase.kind === 'dropped' || phase.kind === 'failed') && <button type="button" className="btn btn-i" onClick={() => void join(false)}>Try again</button>}
            <button type="button" className="btn btn-ghost" onClick={leave}>Back to rooms</button>
          </div>
        </div>
      )}

      {phase.kind === 'in' && room && (
        <>
          {reconnecting && <p role="status" className="rounded-[10px] bg-subtle p-3 text-sm text-warn-ink">Reconnecting… Your connection dropped for a moment.</p>}

          {newBlocked.length > 0 && (
            <div role="alert" className="space-y-2 rounded-[10px] border border-warn p-3 text-sm">
              <p className="font-semibold">Someone you blocked joined</p>
              <p className="text-ink-2">They can hear you and you can hear them. You can leave now, or stay.</p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-danger h-10 px-3" onClick={leave}>Leave the call</button>
                <button type="button" className="btn btn-ghost h-10 px-3" onClick={() => setDismissed(new Set([...dismissed, ...newBlocked]))}>Stay</button>
              </div>
            </div>
          )}

          {(mic === 'blocked' || mic === 'unavailable') && (
            <div role="alert" className="space-y-2 rounded-[10px] bg-subtle p-3 text-sm">
              <p>{mic === 'blocked'
                ? 'Your microphone is blocked. Allow microphone access for this site in your browser settings, then try again. You can still listen and use the text box.'
                : 'We could not use your microphone. Check that one is connected and not in use by another app, then try again.'}</p>
              <button type="button" className="btn btn-ghost h-10 px-3" onClick={() => void enableMic(room)}>Try the microphone again</button>
            </div>
          )}

          {soundBlocked && (
            <button type="button" className="btn btn-i w-full" onClick={() => void room.startAudio().then(() => setSoundBlocked(!room.canPlaybackAudio))}>Turn on sound</button>
          )}

          <div className="flex gap-2">
            <button type="button" className="btn flex-1" disabled={mic === 'starting' || mic === 'blocked' || mic === 'unavailable'} onClick={() => void toggleMic()}>
              {mic === 'on' ? 'Mute' : mic === 'starting' ? 'Starting microphone…' : 'Unmute'}
            </button>
            <button type="button" className="btn btn-danger" onClick={leave}>Leave</button>
          </div>
          <p className="sr-only" role="status">{mic === 'on' ? 'Your microphone is on.' : mic === 'muted' ? 'You are muted.' : ''}</p>

          <div className="space-y-2">
            <h3 className="label">In the call ({people.length})</h3>
            <ul className="space-y-2">
              {people.map((p, i) => {
                const local = i === 0
                const name = local ? `${p.name || 'You'} (you)` : p.name || 'Someone'
                const muted = !p.isMicrophoneEnabled
                return (
                  <li key={p.identity} className="flex flex-wrap items-center gap-2 text-sm">
                    <span aria-hidden className={`size-2.5 rounded-full ${p.isSpeaking ? 'bg-live ring-4 ring-live/25' : 'bg-line'}`} />
                    <span className="flex-1 font-medium">{name}</span>
                    {p.isSpeaking ? <span className="text-xs text-live-ink">Speaking</span> : muted ? <span className="text-xs text-ink-3">Muted</span> : null}
                    {isHost && !local && (confirmRemove === p.identity ? (
                      <span className="flex basis-full items-center gap-2 rounded-[10px] border border-line p-2">
                        <span className="flex-1 text-[13px]">Remove {p.name || 'them'}? They leave the call and cannot rejoin.</span>
                        <button type="button" className="btn btn-danger h-10 px-3" disabled={remove.isPending} onClick={() => remove.mutate({ id: p.identity, name: p.name || 'This person' })}>{remove.isPending ? 'Removing…' : 'Remove'}</button>
                        <button type="button" className="btn btn-ghost h-10 px-3" onClick={() => { setConfirmRemove(null); remove.reset() }}>Keep</button>
                      </span>
                    ) : (
                      <button type="button" aria-label={`Remove ${p.name || 'this person'} from the call`} className="btn btn-ghost h-10 px-3" onClick={() => { setConfirmRemove(p.identity); remove.reset() }}>Remove</button>
                    ))}
                  </li>
                )
              })}
            </ul>
            {removeError && (
              <div role="alert" className="space-y-2 text-sm text-danger">
                <p>{removeError}</p>
                {remove.variables && <button type="button" aria-label={`Try removing ${remove.variables.name} again`} className="btn btn-ghost h-10 px-3" disabled={remove.isPending} onClick={() => remove.mutate(remove.variables!)}>Try again</button>}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="label">Text chat</h3>
            <p className="text-[13px] text-ink-2">Messages are not saved. Only people in the call right now see them, and you see what was said since you joined.</p>
            <ol role="log" aria-label="Messages in this call" aria-live="polite" className="max-h-56 space-y-1 overflow-y-auto rounded-[10px] bg-subtle p-3 text-sm">
              {messages.length === 0 ? <li className="text-ink-3">No messages yet.</li>
                : messages.map((m) => <li key={m.id} className="break-words"><b className={m.mine ? 'text-ink-2' : ''}>{m.from}:</b> {m.text}</li>)}
            </ol>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send() }}>
              <input className="input flex-1" aria-label="Message everyone in the call" maxLength={MAX_MESSAGE} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Say something" autoComplete="off" />
              <button className="btn" disabled={!draft.trim()}>Send</button>
            </form>
            {sendFailed && <p role="alert" className="text-sm text-danger">Could not send that message. Try again.</p>}
          </div>
        </>
      )}
    </section>
  )
}
