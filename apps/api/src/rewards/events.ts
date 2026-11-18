import { and, count, eq, ne } from 'drizzle-orm'
import { roomMembers, rooms } from '@moc/db'
import { db } from '../context'
import { award, qualifyInvite } from './engine'
import type { Intent } from '../visibility'

// The places in the app where something earns points. Each is idempotent (the ledger key sees to that) and none may ever
// break the request that triggered it, so errors are logged and swallowed. Romance never earns points.
const safe = <A extends unknown[]>(name: string, fn: (...a: A) => Promise<unknown>) => async (...a: A) => {
  try { await fn(...a) } catch (err) { console.error(`[rewards] ${name} failed`, err) }
}

/** A profile was saved. Saving an enabled profile is finishing setup; a rich Study or Friends profile is "complete". */
export const onProfileSaved = safe('profile', async (userId: string, intent: Intent, p: { enabled: boolean; prompt: string; bio: string; tags: string[] }) => {
  if (p.enabled) { await award(userId, 'onboarding', 'onboarding'); await qualifyInvite(userId) }
  if (intent !== 'romance' && p.prompt.trim() && p.bio.trim() && p.tags.length > 0) await award(userId, 'profile_complete', 'profile_complete')
})

export const onPhotoApproved = safe('photo', async (userId: string, intent: Intent) => {
  if (intent !== 'romance') await award(userId, 'photo_approved', 'photo')
})

/** An invite was accepted (or two invites crossed): both people connect. */
export const onConnectionAccepted = safe('connection', async (req: { id: string; intent: Intent; fromUserId: string; toUserId: string }) => {
  if (req.intent === 'romance') return
  for (const id of [req.fromUserId, req.toUserId]) {
    if (await award(id, 'connection', `conn:${req.id}`)) await award(id, 'first_connection', 'first_connection') // the bonus pays once, with the first
  }
})

/** Someone got a place in a room. The host is rewarded once a room has at least two other people in it. */
export const onRoomMemberApproved = safe('room', async (roomId: string, userId: string) => {
  const [room] = await db.select({ hostId: rooms.hostId }).from(rooms).where(eq(rooms.id, roomId)).limit(1)
  if (!room || room.hostId === userId) return
  await award(userId, 'room_joined', `room:${roomId}`)
  const [others] = await db.select({ n: count() }).from(roomMembers).where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.status, 'approved'), ne(roomMembers.userId, room.hostId)))
  if ((others?.n ?? 0) >= 2) await award(room.hostId, 'room_hosted', `host:${roomId}`)
})

export const onMeetupAccepted = safe('meetup', async (c: { intent: Intent; userAId: string; userBId: string }, messageId: string) => {
  if (c.intent === 'romance') return
  for (const id of [c.userAId, c.userBId]) await award(id, 'meetup_accepted', `meetup:${messageId}`)
})
