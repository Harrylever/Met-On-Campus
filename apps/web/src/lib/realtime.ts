import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from './api'

/**
 * One native WebSocket per signed-in session (Eden Treaty typed).
 * - sends a presence frame every 30s so the server keeps us "Online now" (Redis TTL is 90s)
 * - turns server pushes into query invalidations
 */
export function useRealtime(opts: { onCampus: boolean; place?: string; onDepartmentDecision?: () => void }) {
  const qc = useQueryClient()
  const [count, setCount] = useState<number | null>(null)
  // Latest callback without reconnecting the socket each render.
  const decided = useRef(opts.onDepartmentDecision)
  decided.current = opts.onDepartmentDecision

  useEffect(() => {
    let closed = false
    let ws: ReturnType<typeof api.ws.subscribe> | null = null
    let ping: ReturnType<typeof setInterval>
    let retry: ReturnType<typeof setTimeout>

    const connect = () => {
      ws = api.ws.subscribe()
      ws.subscribe((msg) => {
        const m = msg.data as any
        if (m.type === 'ready' || m.type === 'presence.count') setCount(m.count ?? m.onCampusNow)
        if (m.type === 'message.new' || m.type === 'meetup.updated') {
          qc.invalidateQueries({ queryKey: ['conversations'] })
          qc.invalidateQueries({ queryKey: ['messages', m.conversationId] })
          qc.invalidateQueries({ queryKey: ['unread'] })
        }
        if (m.type?.startsWith('connection.')) { qc.invalidateQueries({ queryKey: ['conversations'] }); qc.invalidateQueries({ queryKey: ['unread'] }); qc.invalidateQueries({ queryKey: ['discover'] }) }
        if (m.type?.startsWith('room.')) { qc.invalidateQueries({ queryKey: ['rooms'] }); qc.invalidateQueries({ queryKey: ['unread'] }) }
        if (m.type === 'photo.review') qc.invalidateQueries({ queryKey: ['photos'] })
        if (m.type === 'department.request') { qc.invalidateQueries({ queryKey: ['dept-requests'] }); qc.invalidateQueries({ queryKey: ['meta'] }); decided.current?.() }
        if (m.type === 'presence.count') qc.invalidateQueries({ queryKey: ['discover'] })
      })
      ws.on('open', () => {
        const beat = () => opts.onCampus && ws?.send({ type: 'presence', place: opts.place })
        beat(); ping = setInterval(beat, 30_000)
      })
      ws.on('close', () => { clearInterval(ping); if (!closed) retry = setTimeout(connect, 3000) })
    }
    connect()
    return () => { closed = true; clearInterval(ping); clearTimeout(retry); ws?.close() }
  }, [opts.onCampus, opts.place, qc])

  return { onCampusNow: count }
}
