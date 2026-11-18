import { and, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm'
import { conversations, emailCodes, profilePhotos, reports, roomMembers, rooms, users } from '@moc/db'
import { audit } from './admin/session'
import { bus, db, redis, topics } from './context'
import { discardFile } from './photos'
import * as presence from './presence'

export type DeletedBy = { kind: 'self' } | { kind: 'staff'; adminId: string; reason: string; ip?: string }

/**
 * Permanently removes a student and everything that is theirs: profile, photos (files too), chats and the messages in
 * them, requests, rooms they host (people with a place or waiting are told it is cancelled), blocks, sessions,
 * presence, and their points, streak, badges and leaderboard entry. Friends they invited keep what they earned; the
 * link back to this account is cleared. Reports and moderation records stay, with the link to the account cleared, because deleting an account
 * must not erase safety evidence: a report about them keeps only their name and campus. The deletion is audited with the
 * account id and campus, never the email or name. Returns false if there was no such account.
 */
export async function deleteAccount(userId: string, by: DeletedBy) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return false

  const gone = await db.transaction(async (tx) => {
    const photoKeys = (await tx.select({ key: profilePhotos.storageKey }).from(profilePhotos).where(eq(profilePhotos.userId, userId))).map((r) => r.key)

    // Rooms they host that have not finished: everyone with a place (or waiting) needs to hear it is off.
    const hosted = await tx.select().from(rooms).where(and(eq(rooms.hostId, userId), gt(rooms.endsAt, new Date()), isNull(rooms.cancelledAt)))
    const affected = hosted.length
      ? await tx.select({ roomId: roomMembers.roomId, userId: roomMembers.userId }).from(roomMembers)
        .where(and(inArray(roomMembers.roomId, hosted.map((r) => r.id)), ne(roomMembers.userId, userId), inArray(roomMembers.status, ['approved', 'pending'])))
      : []

    // People who had a conversation with them: their inbox changes.
    const convs = await tx.select({ a: conversations.userAId, b: conversations.userBId }).from(conversations).where(or(eq(conversations.userAId, userId), eq(conversations.userBId, userId)))
    const counterparts = [...new Set(convs.map((c) => (c.a === userId ? c.b : c.a)))]

    await tx.update(reports).set({ reportedLabel: `${user.name}, ${user.university}` }).where(eq(reports.reportedId, userId))
    await tx.delete(emailCodes).where(eq(emailCodes.email, user.email))
    await tx.delete(users).where(eq(users.id, userId)) // cascades everything else that is theirs
    return { photoKeys, hosted, affected, counterparts }
  })

  // After the data is gone: files, live state and notifications. None of this can undo the deletion, so failures here are only logged.
  await Promise.all(gone.photoKeys.map((k) => discardFile(k)))
  await presence.leave(user.university, userId).catch(() => {})
  await redis.del(`delcode:${userId}`, `delcode:tries:${userId}`).catch(() => {})
  for (const a of gone.affected) bus.publish(topics.user(a.userId), { type: 'room.cancelled', roomId: a.roomId, title: gone.hosted.find((r) => r.id === a.roomId)?.title })
  for (const r of gone.hosted) bus.publish(topics.campus(user.university), { type: 'room.changed', roomId: r.id, intent: r.intent })
  for (const id of gone.counterparts) bus.publish(topics.user(id), { type: 'connection.removed' })
  bus.publish(topics.user(userId), { type: 'account.deleted' }) // signs out their other open tabs and devices
  await audit(by.kind === 'staff' ? by.adminId : null, by.kind === 'staff' ? 'user.delete' : 'account.self_delete', {
    targetType: 'user', targetId: userId, ip: by.kind === 'staff' ? by.ip : undefined,
    meta: { campus: user.university, by: by.kind, ...(by.kind === 'staff' ? { reason: by.reason.slice(0, 300) } : {}) },
  })
  return true
}
