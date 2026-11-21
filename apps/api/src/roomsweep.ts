import { and, eq, gt, isNull, lte } from 'drizzle-orm'
import { roomMembers, rooms } from '@moc/db'
import { db } from './context'
import { livekit, roomName } from './livekit'

const WINDOW_MS = 15 * 60_000
const msg = (e: unknown) => (e instanceof Error ? e.message : 'unknown error')

/** Closes the call of every online room that ended in the last 15 minutes (closing is idempotent). Returns how many it closed. */
export async function sweepEndedRooms(now = new Date()): Promise<number> {
  const ended = await db.select({ id: rooms.id }).from(rooms).where(and(
    eq(rooms.mode, 'online'), isNull(rooms.cancelledAt), lte(rooms.endsAt, now), gt(rooms.endsAt, new Date(+now - WINDOW_MS)),
  ))
  let closed = 0
  for (const r of ended) {
    try { await livekit.closeRoom(roomName(r.id)); closed++ } catch (e) { console.error('room sweep: close failed:', msg(e)) }
  }
  return closed
}

export function startRoomSweep(): void {
  setInterval(() => { sweepEndedRooms().catch((e) => console.error('room sweep failed:', msg(e))) }, 60_000)
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
