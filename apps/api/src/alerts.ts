import { eq, inArray, sql } from 'drizzle-orm'
import { users } from '@moc/db'
import { db, redis } from './context'
import { env } from './env'
import { sendWaitingAlert, type Waiting } from './email'
import * as presence from './presence'

// "Something is waiting" emails. One email at most per person per stretch of news, only when they are not in the app,
// and only for things that have gone unanswered for a while. The email itself is generic (counts, no names, no mode).
export const GRACE_MIN = 10      // something must have been waiting this long (they may be looking at it right now)
export const COOLDOWN_H = 6      // never more than one email per person in this time
export const LOOKBACK_H = 24     // ignore anything older than this: it is stale, not news (so the same news is never emailed twice)
const MAX_PER_RUN = 200

type Counts = { invites: number; chats: number; rooms: number; latest: number }
const iso = (d: Date) => d.toISOString()
// A pair that has blocked each other never generates news for either side.
const notBlocked = (a: string, b: string) => sql`not exists (select 1 from blocks bl where (bl.blocker_id = ${sql.raw(a)} and bl.blocked_id = ${sql.raw(b)}) or (bl.blocker_id = ${sql.raw(b)} and bl.blocked_id = ${sql.raw(a)}))`

/** Everything waiting, per person, from the same three sources the in-app badges use. */
async function waitingByPerson(now: Date) {
  const grace = iso(new Date(+now - GRACE_MIN * 60_000)), since = iso(new Date(+now - LOOKBACK_H * 3_600_000))
  const per = new Map<string, Counts>()
  const add = (rows: Iterable<Record<string, unknown>>, key: 'invites' | 'chats' | 'rooms') => {
    for (const r of rows) {
      const id = String(r.user_id), c = per.get(id) ?? { invites: 0, chats: 0, rooms: 0, latest: 0 }
      c[key] += Number(r.n); c.latest = Math.max(c.latest, +new Date(r.latest as string)); per.set(id, c)
    }
  }

  // Invites nobody has answered.
  add(await db.execute(sql`
    select r.to_user_id as user_id, count(*)::int as n, max(r.created_at) as latest
    from connection_requests r join users s on s.id = r.from_user_id
    where r.status = 'pending' and r.created_at between ${since}::timestamptz and ${grace}::timestamptz and s.status = 'active'
      and ${notBlocked('r.from_user_id', 'r.to_user_id')}
    group by r.to_user_id`), 'invites')

  // Unread chats: one per conversation, from people who are still around, in conversations that are open, and not
  // the intro message of an invite (that is already counted above).
  add(await db.execute(sql`
    select rcp.id as user_id, count(distinct c.id)::int as n, max(m.created_at) as latest
    from messages m
    join conversations c on c.id = m.conversation_id
    join users s on s.id = m.sender_id
    cross join lateral (select case when m.sender_id = c.user_a_id then c.user_b_id else c.user_a_id end as id) rcp
    left join conversation_reads cr on cr.conversation_id = c.id and cr.user_id = rcp.id
    where m.created_at between ${since}::timestamptz and ${grace}::timestamptz and s.status = 'active'
      and (cr.read_at is null or m.created_at > cr.read_at)
      and ${notBlocked('c.user_a_id', 'c.user_b_id')}
      and not (
        exists (select 1 from connection_requests q where q.intent = c.intent and q.status = 'declined' and ((q.from_user_id = c.user_a_id and q.to_user_id = c.user_b_id) or (q.from_user_id = c.user_b_id and q.to_user_id = c.user_a_id)))
        and not exists (select 1 from connection_requests q where q.intent = c.intent and q.status = 'accepted' and ((q.from_user_id = c.user_a_id and q.to_user_id = c.user_b_id) or (q.from_user_id = c.user_b_id and q.to_user_id = c.user_a_id))))
      and not exists (select 1 from connection_requests q where q.intent = c.intent and q.status = 'pending' and q.from_user_id = m.sender_id and q.to_user_id = rcp.id)
    group by rcp.id`), 'chats')

  // Rooms: people waiting for a host's answer...
  add(await db.execute(sql`
    select r.host_id as user_id, count(*)::int as n, max(rm.created_at) as latest
    from room_members rm join rooms r on r.id = rm.room_id join users s on s.id = rm.user_id
    where rm.status = 'pending' and r.cancelled_at is null and r.ends_at > now() and s.status = 'active'
      and rm.created_at between ${since}::timestamptz and ${grace}::timestamptz and ${notBlocked('r.host_id', 'rm.user_id')}
    group by r.host_id`), 'rooms')
  // ...and answers or cancellations a member has not looked at.
  add(await db.execute(sql`
    select rm.user_id as user_id, count(*)::int as n, max(rm.created_at) as latest
    from room_members rm join rooms r on r.id = rm.room_id
    where r.host_id <> rm.user_id and r.ends_at > now() and rm.decision_seen_at is null
      and (rm.status <> 'pending' or r.cancelled_at is not null)
      and rm.created_at between ${since}::timestamptz and ${grace}::timestamptz
    group by rm.user_id`), 'rooms')
  return per
}

export type RunOptions = { now?: Date; send?: (to: string, w: Waiting, token: string) => Promise<void>; lock?: boolean }

/** One pass. Safe to run often; the rules above decide who actually gets an email. */
export async function runAlerts({ now = new Date(), send = sendWaitingAlert, lock = true }: RunOptions = {}) {
  // Several API instances must not each email the same person: only one pass at a time.
  if (lock && !(await redis.set('alerts:lock', '1', 'EX', 55, 'NX'))) return { sent: 0, skipped: 0 }
  const per = await waitingByPerson(now)
  if (per.size === 0) return { sent: 0, skipped: 0 }
  const people = await db.select().from(users).where(inArray(users.id, [...per.keys()]))
  const online = new Map<string, Set<string>>()
  const here = async (campus: string) => online.get(campus) ?? (online.set(campus, new Set(await presence.here(campus))), online.get(campus)!)

  let sent = 0, skipped = 0
  const due = people.map((u) => ({ u, c: per.get(u.id)! })).sort((a, b) => a.c.latest - b.c.latest)
  for (const { u, c } of due) {
    if (sent >= MAX_PER_RUN) break
    const sig = `${c.invites}|${c.chats}|${c.rooms}|${Math.floor(c.latest / 1000)}`
    const since = u.lastAlertAt ? +now - +u.lastAlertAt : Infinity
    const skip = !u.emailAlerts || u.status !== 'active' || !u.verifiedAt
      || since < COOLDOWN_H * 3_600_000                                  // not more than one every few hours
      || u.lastAlertSig === sig                                          // not the same news twice
      || (await here(u.university)).has(u.id)                            // they are in the app: they can see it
    if (skip) { skipped++; continue }
    try {
      await send(u.email, { invites: c.invites, chats: c.chats, rooms: c.rooms }, u.unsubscribeToken)
      await db.update(users).set({ lastAlertAt: now, lastAlertSig: sig }).where(eq(users.id, u.id))
      sent++
    } catch (err) { console.error('[alerts] send failed', u.id, err) } // left for the next pass
  }
  return { sent, skipped }
}

export function startAlerts() {
  if (!env.alertsEnabled) return
  const tick = () => runAlerts().then((r) => r.sent && console.log(`[alerts] sent ${r.sent}`)).catch((e) => console.error('[alerts] pass failed', e))
  setInterval(tick, 60_000)
  console.log('[alerts] email alerts on')
}
