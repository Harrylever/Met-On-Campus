import { and, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { roomMembers, rooms, users } from '@moc/db'
import { db } from './context'
import { livekit, roomName } from './livekit'

const WINDOW_MS = 15 * 60_000
const msg = (e: unknown) => (e instanceof Error ? e.message : 'unknown error')

/**
 * Closes the call of every online room that ended in the last 15 minutes, and of every cancelled online room until 15
 * minutes after its original end (so a close that failed at cancel time is retried, and an old token cannot reopen it).
 * Closing is idempotent. Returns how many it closed.
 */
export async function sweepEndedRooms(now = new Date()): Promise<number> {
  const since = new Date(+now - WINDOW_MS)
  const ended = await db.select({ id: rooms.id }).from(rooms).where(and(
    eq(rooms.mode, 'online'), gt(rooms.endsAt, since),
    or(isNotNull(rooms.cancelledAt), lte(rooms.endsAt, now)),
  ))
  let closed = 0
  for (const r of ended) {
    try { await livekit.closeRoom(roomName(r.id)); closed++ } catch (e) { console.error('room sweep: close failed:', msg(e)) }
  }
  return closed
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A removed or suspended person's LiveKit token stays valid until the room's endsAt, so they could reconnect straight
 * to LiveKit. This pass (run every minute) kicks anyone in a live call who is not an approved member or is suspended.
 */
export async function enforceLiveMembership(now = new Date()): Promise<number> {
  const live = await db.select({ id: rooms.id }).from(rooms).where(and(
    eq(rooms.mode, 'online'), isNull(rooms.cancelledAt), lte(rooms.startsAt, now), gt(rooms.endsAt, now)))
  let removed = 0
  for (const r of live) {
    try {
      const name = roomName(r.id)
      const ids = [...new Set((await livekit.participants(name)).map((p) => p.identity).filter((i) => UUID.test(i)))]
      if (ids.length === 0) continue
      const [approved, suspended] = await Promise.all([
        db.select({ id: roomMembers.userId }).from(roomMembers).where(and(eq(roomMembers.roomId, r.id), eq(roomMembers.status, 'approved'), inArray(roomMembers.userId, ids))),
        db.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), eq(users.status, 'suspended'))),
      ])
      const ok = new Set(approved.map((m) => m.id)); for (const u of suspended) ok.delete(u.id)
      for (const id of ids.filter((i) => !ok.has(i))) {
        try { await livekit.removeParticipant(name, id); removed++ } catch (e) { console.error('enforce membership: remove failed:', msg(e)) }
      }
    } catch (e) { console.error('enforce membership: room failed:', msg(e)) }
  }
  return removed
}

let running = false

/** One sweep pass. Skipped when LiveKit is not configured, or while the previous pass is still running. Never throws. */
export async function runSweepPass(now = new Date()): Promise<'ran' | 'skipped'> {
  if (running || !livekit.configured()) return 'skipped'
  running = true
  try {
    const log = (e: unknown) => console.error('room sweep failed:', msg(e))
    await Promise.all([sweepEndedRooms(now).catch(log), enforceLiveMembership(now).catch(log)])
    return 'ran'
  } finally {
    running = false
  }
}

/** Started once, from server.ts. */
export function startRoomSweep(): void {
  setInterval(() => { void runSweepPass() }, 60_000)
}

/** Takes a student out of every online call that is live right now and where they are approved. Never throws. */
export async function removeFromLiveCalls(userId: string, now = new Date()): Promise<void> {
  try {
    const live = await db.select({ id: rooms.id }).from(rooms).innerJoin(roomMembers, eq(roomMembers.roomId, rooms.id)).where(and(
      eq(rooms.mode, 'online'), isNull(rooms.cancelledAt), lte(rooms.startsAt, now), gt(rooms.endsAt, now),
      eq(roomMembers.userId, userId), eq(roomMembers.status, 'approved'),
    ))
    for (const r of live) {
      try { await livekit.removeParticipant(roomName(r.id), userId) } catch (e) { console.error('remove from live call failed:', msg(e)) }
    }
  } catch (e) { console.error('remove from live calls failed:', msg(e)) }
}
