import { and, eq, inArray } from 'drizzle-orm'
import { generateRequestDetails, setVapidDetails } from 'web-push'
import { pushSubscriptions, users } from '@moc/db'
import { bus, db, redis } from './context'
import { env } from './env'
import * as presence from './presence'

export const pushEnabled = !!(env.vapidPublicKey && env.vapidPrivateKey)
if (pushEnabled) setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey)

// ---- Which push services we will talk to ------------------------------------------------------------------------
// The server sends to an address the browser gave us, so an attacker could hand over an internal address and make us call
// it. Only the real browser push services are accepted (Google, Mozilla, Apple, Microsoft), and only over HTTPS.
const SERVICES = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']
export function allowedEndpoint(raw: string) {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (env.pushExtraHosts.includes(u.host)) return true // local mock, never in production
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false
  return SERVICES.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
}

// ---- What a notification says ---------------------------------------------------------------------------------------
// Lock screens are seen by other people, so the text is deliberately generic: no names, no messages, no mode. (The URL it
// opens is inside the notification's data and is never displayed.)
export type PushKind = 'invite' | 'message' | 'room'
export type Notice = { kind: PushKind; body: string; url: string }
type Ev = Record<string, any>

export function noticeFor(e: Ev): Notice | null {
  switch (e.type) {
    case 'connection.new': return { kind: 'invite', body: 'You have a new invite', url: `/messages?intent=${e.intent}&with=${e.from?.id ?? ''}` }
    case 'connection.updated': return e.status === 'accepted' ? { kind: 'invite', body: 'Your invite was accepted', url: '/messages' } : null // a "not now" is never announced
    case 'message.new': return { kind: 'message', body: 'You have a new message', url: `/messages?intent=${e.intent}&with=${e.message?.senderId ?? ''}` }
    case 'meetup.updated': return { kind: 'message', body: 'A meetup proposal was answered', url: '/messages' }
    case 'room.request': return { kind: 'room', body: 'Someone asked to join your room', url: '/rooms' }
    case 'room.decision': return { kind: 'room', body: 'Your room request was answered', url: '/rooms' }
    case 'room.updated': return { kind: 'room', body: 'A room you joined was changed', url: '/rooms' }
    case 'room.cancelled': return { kind: 'room', body: 'A room you joined was cancelled', url: '/rooms' }
    default: return null
  }
}

export type Payload = { title: string; body: string; url: string; tag: string }
export type Sub = { endpoint: string; p256dh: string; auth: string }
/** Sends one notification. Returns the push service's HTTP status. Replaceable, so tests can look at what would go out. */
export type Sender = (sub: Sub, payload: Payload) => Promise<number>

const realSender: Sender = async (sub, payload) => {
  const d = generateRequestDetails({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload),
    { TTL: 3600, urgency: 'normal', topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined })
  const res = await fetch(d.endpoint, { method: d.method, headers: d.headers as Record<string, string>, body: d.body as Uint8Array<ArrayBuffer>, signal: AbortSignal.timeout(8000) })
  return res.status
}
let send: Sender = realSender
export const setPushSender = (fn: Sender | null) => { send = fn ?? realSender }

// ---- Delivery ------------------------------------------------------------------------------------------------------
const pending = new Set<Promise<unknown>>()
/** Resolves when every notification started so far has been handled (tests). */
export const pushIdle = () => Promise.allSettled([...pending])

/** Send to every device of one person. A device the push service says is gone (404/410) is forgotten. */
export async function pushToUser(userId: string, notice: Notice, opts: { force?: boolean } = {}) {
  if (!pushEnabled) return 0
  if (!opts.force) {
    // Only one notification of a kind per couple of minutes: ten messages in a minute are one buzz, not ten.
    if (!(await redis.set(`push:th:${userId}:${notice.kind}`, '1', 'EX', 120, 'NX'))) return 0
    // Someone looking at the app sees it live; a notification on top would only be noise.
    const [u] = await db.select({ university: users.university, status: users.status }).from(users).where(eq(users.id, userId)).limit(1)
    if (!u || u.status !== 'active' || (await presence.here(u.university)).includes(userId)) return 0
  }
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  const payload: Payload = { title: 'Met On Campus', body: notice.body, url: notice.url, tag: notice.kind }
  const gone: string[] = []
  let delivered = 0
  await Promise.all(subs.map(async (s) => {
    try {
      const status = await send(s, payload)
      if (status === 404 || status === 410) gone.push(s.id)
      else if (status >= 200 && status < 300) { delivered++; await db.update(pushSubscriptions).set({ lastSentAt: new Date() }).where(eq(pushSubscriptions.id, s.id)) }
      else console.error('[push] service answered', status)
    } catch (err) { console.error('[push] send failed', (err as Error).message) } // never let one device stop the rest
  }))
  if (gone.length) await db.delete(pushSubscriptions).where(and(inArray(pushSubscriptions.id, gone), eq(pushSubscriptions.userId, userId)))
  return delivered
}

// Every event published to a person is a candidate for a notification.
bus.tap((topic, payload) => {
  if (!pushEnabled || !topic.startsWith('user:')) return
  const notice = noticeFor(payload as Ev)
  if (!notice) return
  const p = pushToUser(topic.slice('user:'.length), notice).catch((err) => console.error('[push] failed', err)).finally(() => pending.delete(p))
  pending.add(p)
})
