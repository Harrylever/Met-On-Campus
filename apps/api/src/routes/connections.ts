import { Elysia, t } from 'elysia'
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { connectionRequests, conversationReads, conversations, messages, roomMembers, rooms, users } from '@moc/db'
import { authed, publicSelf } from '../auth'
import { limited } from '../ratelimit'
import { bus, db, topics } from '../context'
import { canonical, spotsFor } from '../lists'
import { canInteract, orderedPair, type Intent as IntentName } from '../visibility'
import { blockedWith, isBlockedBetween } from '../blocks'
import { approvedPhotoIds, romanceMatched } from '../photos'
import { between, pairRequest, type Req } from '../requests'
import { onConnectionAccepted, onMeetupAccepted } from '../rewards/events'
import { newBadgesOf } from '../rewards/badges'

const Intent = t.Union([t.Literal('study'), t.Literal('friends'), t.Literal('romance')])
type User = typeof users.$inferSelect

async function myConversation(userId: string, id: string) {
  const [c] = await db.select().from(conversations)
    .where(and(eq(conversations.id, id), or(eq(conversations.userAId, userId), eq(conversations.userBId, userId)))).limit(1)
  if (!c || (await isBlockedBetween(c.userAId, c.userBId))) return undefined
  return c
}

/**
 * My conversations (optionally one mode) with the state of each: the request between us, and how many messages from the
 * other person I have not opened. A conversation I declined is hidden from me; the other person just sees it closed.
 */
async function loadInbox(user: User, intent?: IntentName) {
  const blocked = await blockedWith(user.id)
  const convs = (await db.select().from(conversations)
    .where(and(intent ? eq(conversations.intent, intent) : undefined, or(eq(conversations.userAId, user.id), eq(conversations.userBId, user.id)))))
    .filter((c) => !blocked.has(c.userAId === user.id ? c.userBId : c.userAId))
  if (convs.length === 0) return []
  const reqs: Req[] = await db.select().from(connectionRequests)
    .where(and(intent ? eq(connectionRequests.intent, intent) : undefined, or(eq(connectionRequests.fromUserId, user.id), eq(connectionRequests.toUserId, user.id))))
  const unread = new Map((await db.select({ id: messages.conversationId, n: sql<number>`count(*)::int` }).from(messages)
    .leftJoin(conversationReads, and(eq(conversationReads.conversationId, messages.conversationId), eq(conversationReads.userId, user.id)))
    .where(and(inArray(messages.conversationId, convs.map((c) => c.id)), ne(messages.senderId, user.id), or(isNull(conversationReads.readAt), gt(messages.createdAt, conversationReads.readAt))))
    .groupBy(messages.conversationId)).map((r) => [r.id, r.n]))
  return convs.map((c) => {
    const otherId = c.userAId === user.id ? c.userBId : c.userAId
    const r = between(reqs.filter((x) => x.intent === c.intent), user.id, otherId)
    const request = r ? { id: r.id, status: r.status, direction: (r.fromUserId === user.id ? 'sent' : 'received') as 'sent' | 'received' } : null
    return { c, otherId, request, unread: unread.get(c.id) ?? 0 }
  }).filter((x) => !(x.request?.status === 'declined' && x.request.direction === 'received'))
}

export const connectionRoutes = new Elysia().use(authed)
  // Invite to Study / Say Hi / Send Spark. Creates the request and the intent-scoped conversation.
  // If they already invited you for this mode, you have both said yes: it becomes a connection straight away.
  .post('/connections', async ({ user, body, status, set }) => {
    const over = await limited(user.id, 'invite', set); if (over) return status(429, over)
    const [other] = await db.select().from(users).where(eq(users.id, body.toUserId)).limit(1)
    if (!other || !(await canInteract(user, other, body.intent))) return status(403, { error: 'not_allowed' })
    const [a, b] = orderedPair(user.id, other.id)
    const result = await db.transaction(async (tx) => {
      const [conv] = await tx.insert(conversations).values({ intent: body.intent, userAId: a, userBId: b })
        .onConflictDoUpdate({ target: [conversations.intent, conversations.userAId, conversations.userBId], set: { intent: body.intent } }).returning()
      const [theirs] = await tx.update(connectionRequests).set({ status: 'accepted' }).where(and(
        eq(connectionRequests.intent, body.intent), eq(connectionRequests.fromUserId, other.id), eq(connectionRequests.toUserId, user.id), eq(connectionRequests.status, 'pending'))).returning()
      if (theirs) return { req: theirs, conv: conv!, matched: true }
      const [req] = await tx.insert(connectionRequests).values({ intent: body.intent, fromUserId: user.id, toUserId: other.id }).onConflictDoNothing().returning()
      return { req, conv: conv!, matched: false }
    })
    if (result.matched) await onConnectionAccepted(result.req!)
    if (result.matched) bus.publish(topics.user(other.id), { type: 'connection.updated', id: result.req!.id, status: 'accepted', intent: body.intent })
    else if (result.req) bus.publish(topics.user(other.id), { type: 'connection.new', intent: body.intent, conversationId: result.conv.id, from: publicSelf(user) })
    return { requestId: result.req?.id ?? null, conversationId: result.conv.id, matched: result.matched }
  }, { body: t.Object({ toUserId: t.String({ format: 'uuid' }), intent: Intent }) })

  // The person who was invited says yes or not now. Declining closes the conversation and hides it from them.
  .patch('/connections/:id', async ({ user, params, body, status }) => {
    const [req] = await db.update(connectionRequests).set({ status: body.status })
      .where(and(eq(connectionRequests.id, params.id), eq(connectionRequests.toUserId, user.id), eq(connectionRequests.status, 'pending'))).returning()
    if (!req) return status(404, { error: 'not_found' })
    if (req.status === 'accepted') await onConnectionAccepted(req)
    bus.publish(topics.user(req.fromUserId), { type: 'connection.updated', id: req.id, status: req.status, intent: req.intent })
    return { request: req }
  }, { body: t.Object({ status: t.Union([t.Literal('accepted'), t.Literal('declined')]) }) })

  // Inbox, segmented: `intent` is required so Study never leaks into Friends or Romance.
  .get('/conversations', async ({ user, query }) => {
    const inbox = await loadInbox(user, query.intent)
    const photos = await approvedPhotoIds(inbox.map((x) => x.otherId), query.intent)
    const out = await Promise.all(inbox.map(async ({ c, otherId, request, unread }) => {
      const [other] = await db.select().from(users).where(eq(users.id, otherId)).limit(1)
      const [last] = await db.select().from(messages).where(eq(messages.conversationId, c.id)).orderBy(desc(messages.createdAt)).limit(1)
      // In Romance a conversation exists as soon as a Spark is sent, so the photo waits for the match (Spark accepted).
      const photoId = query.intent !== 'romance' || (await romanceMatched(user.id, otherId)) ? (photos.get(otherId) ?? null) : null
      return { id: c.id, intent: c.intent, with: publicSelf(other!), photoId, request, unread, last: last ?? null }
    }))
    return { conversations: out.sort((x, y) => +(y.last?.createdAt ?? 0) - +(x.last?.createdAt ?? 0)) }
  }, { query: t.Object({ intent: Intent }) })

  // What needs my attention, per mode: conversations with unread messages, plus invites I have not answered.
  .get('/me/unread', async ({ user }) => {
    const byIntent = { study: 0, friends: 0, romance: 0 }
    let requests = 0
    for (const x of await loadInbox(user)) {
      const invited = x.request?.status === 'pending' && x.request.direction === 'received'
      if (invited) requests++
      if (invited || x.unread > 0) byIntent[x.c.intent]++
    }
    // Rooms: people waiting for my answer as a host, plus answers and cancellations I have not looked at as a member.
    const now = new Date()
    const [waiting] = await db.select({ n: sql<number>`count(*)::int` }).from(roomMembers).innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
      .where(and(eq(rooms.hostId, user.id), eq(roomMembers.status, 'pending'), isNull(rooms.cancelledAt), gt(rooms.endsAt, now)))
    const [news] = await db.select({ n: sql<number>`count(*)::int` }).from(roomMembers).innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
      .where(and(eq(roomMembers.userId, user.id), ne(rooms.hostId, user.id), gt(rooms.endsAt, now), isNull(roomMembers.decisionSeenAt), or(ne(roomMembers.status, 'pending'), sql`${rooms.cancelledAt} is not null`)))
    return { byIntent, total: byIntent.study + byIntent.friends + byIntent.romance, requests, rooms: (waiting?.n ?? 0) + (news?.n ?? 0), badges: await newBadgesOf(user.id) }
  })

  .get('/conversations/:id/messages', async ({ user, params, status }) => {
    if (!(await myConversation(user.id, params.id))) return status(404, { error: 'not_found' })
    // The newest 200, oldest first. (Ordering ascending with a limit would stop new messages showing after 200.)
    const latest = await db.select().from(messages).where(eq(messages.conversationId, params.id)).orderBy(desc(messages.createdAt)).limit(200)
    return { messages: latest.reverse() }
  })
  // I opened this conversation: everything in it so far is read.
  .post('/conversations/:id/read', async ({ user, params, status }) => {
    if (!(await myConversation(user.id, params.id))) return status(404, { error: 'not_found' })
    await db.insert(conversationReads).values({ conversationId: params.id, userId: user.id })
      .onConflictDoUpdate({ target: [conversationReads.conversationId, conversationReads.userId], set: { readAt: new Date() } })
    return { ok: true }
  })
  .post('/conversations/:id/messages', async ({ user, params, body, status, set }) => {
    const over = (await limited(user.id, 'message', set)) ?? (body.kind === 'meetup' ? await limited(user.id, 'meetup', set) : null)
    if (over) return status(429, over)
    const conv = await myConversation(user.id, params.id)
    if (!conv) return status(404, { error: 'not_found' })
    const otherId = conv.userAId === user.id ? conv.userBId : conv.userAId
    // Not now means closed. Until they answer an invite, the person who sent it can write one message, not a stream.
    const req = await pairRequest(conv.intent, user.id, otherId)
    if (req?.status === 'declined') return status(403, { error: 'conversation_closed' })
    if (req?.status === 'pending' && req.fromUserId === user.id) {
      const [mineSoFar] = await db.select({ n: sql<number>`count(*)::int` }).from(messages).where(and(eq(messages.conversationId, conv.id), eq(messages.senderId, user.id)))
      if ((mineSoFar?.n ?? 0) >= 1) return status(409, { error: 'waiting_for_reply' })
    }
    if (body.kind === 'meetup') {
      // Only spots staff have listed for this campus (public places). The list's own spelling is what gets stored.
      const spot = body.where ? canonical(await spotsFor(user.university), body.where) : undefined
      if (!spot || !body.when) return status(422, { error: 'public_campus_spot_required' })
      if (new Date(body.when) < new Date()) return status(422, { error: 'time_in_past' })
      body.where = spot
    } else if (!body.body?.trim()) return status(422, { error: 'empty' })
    const [msg] = await db.insert(messages).values(body.kind === 'meetup'
      ? { conversationId: conv.id, senderId: user.id, kind: 'meetup', meetupWhere: body.where, meetupWhen: new Date(body.when!), meetupStatus: 'pending' }
      : { conversationId: conv.id, senderId: user.id, kind: 'text', body: body.body!.trim() }).returning()
    bus.publish(topics.user(otherId), { type: 'message.new', conversationId: conv.id, intent: conv.intent, message: msg })
    return { message: msg }
  }, { body: t.Object({ kind: t.Union([t.Literal('text'), t.Literal('meetup')]), body: t.Optional(t.String({ maxLength: 2000 })), where: t.Optional(t.String()), when: t.Optional(t.String({ format: 'date-time' })) }) })
  // Only the recipient of a proposal can confirm or decline it.
  .patch('/messages/:id/meetup', async ({ user, params, body, status }) => {
    const [row] = await db.select({ m: messages, c: conversations }).from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId)).where(eq(messages.id, params.id)).limit(1)
    if (!row || row.m.kind !== 'meetup' || row.m.senderId === user.id || ![row.c.userAId, row.c.userBId].includes(user.id)) return status(404, { error: 'not_found' })
    if (await isBlockedBetween(row.c.userAId, row.c.userBId)) return status(404, { error: 'not_found' })
    if ((await pairRequest(row.c.intent, row.c.userAId, row.c.userBId))?.status === 'declined') return status(403, { error: 'conversation_closed' })
    if (row.m.meetupStatus !== 'pending') return status(409, { error: 'already_resolved' })
    if (row.m.meetupWhen && row.m.meetupWhen < new Date()) return status(409, { error: 'expired' })
    const [msg] = await db.update(messages).set({ meetupStatus: body.status }).where(eq(messages.id, params.id)).returning()
    if (body.status === 'confirmed') await onMeetupAccepted(row.c, row.m.id)
    bus.publish(topics.user(row.m.senderId), { type: 'meetup.updated', conversationId: row.c.id, message: msg })
    return { message: msg }
  }, { body: t.Object({ status: t.Union([t.Literal('confirmed'), t.Literal('declined')]) }) })
  .get('/spots', async ({ user }) => ({ spots: await spotsFor(user.university) }))
