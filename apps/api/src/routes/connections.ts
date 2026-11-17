import { Elysia, t } from 'elysia'
import { and, desc, eq, or, sql } from 'drizzle-orm'
import { connectionRequests, conversations, messages, users } from '@moc/db'
import { authed, publicSelf } from '../auth'
import { bus, CAMPUS_SPOTS, db, topics } from '../context'
import { canInteract, orderedPair } from '../visibility'

const Intent = t.Union([t.Literal('study'), t.Literal('friends'), t.Literal('romance')])

async function myConversation(userId: string, id: string) {
  const [c] = await db.select().from(conversations)
    .where(and(eq(conversations.id, id), or(eq(conversations.userAId, userId), eq(conversations.userBId, userId)))).limit(1)
  return c
}

export const connectionRoutes = new Elysia().use(authed)
  // Invite to Study / Say Hi / Send Spark. Creates the request and the intent-scoped conversation.
  .post('/connections', async ({ user, body, status }) => {
    const [other] = await db.select().from(users).where(eq(users.id, body.toUserId)).limit(1)
    if (!other || !(await canInteract(user, other, body.intent))) return status(403, { error: 'not_allowed' })
    const [a, b] = orderedPair(user.id, other.id)
    const result = await db.transaction(async (tx) => {
      const [req] = await tx.insert(connectionRequests).values({ intent: body.intent, fromUserId: user.id, toUserId: other.id })
        .onConflictDoNothing().returning()
      const [conv] = await tx.insert(conversations).values({ intent: body.intent, userAId: a, userBId: b })
        .onConflictDoUpdate({ target: [conversations.intent, conversations.userAId, conversations.userBId], set: { intent: body.intent } }).returning()
      return { req, conv: conv! }
    })
    if (result.req) bus.publish(topics.user(other.id), { type: 'connection.new', intent: body.intent, conversationId: result.conv.id, from: publicSelf(user) })
    return { requestId: result.req?.id ?? null, conversationId: result.conv.id }
  }, { body: t.Object({ toUserId: t.String({ format: 'uuid' }), intent: Intent }) })
  .patch('/connections/:id', async ({ user, params, body, status }) => {
    const [req] = await db.update(connectionRequests).set({ status: body.status })
      .where(and(eq(connectionRequests.id, params.id), eq(connectionRequests.toUserId, user.id), eq(connectionRequests.status, 'pending'))).returning()
    if (!req) return status(404, { error: 'not_found' })
    bus.publish(topics.user(req.fromUserId), { type: 'connection.updated', id: req.id, status: req.status })
    return { request: req }
  }, { body: t.Object({ status: t.Union([t.Literal('accepted'), t.Literal('declined')]) }) })

  // Inbox, segmented: `intent` is required so Study never leaks into Friends or Romance.
  .get('/conversations', async ({ user, query }) => {
    const rows = await db.select().from(conversations)
      .where(and(eq(conversations.intent, query.intent), or(eq(conversations.userAId, user.id), eq(conversations.userBId, user.id))))
    const out = await Promise.all(rows.map(async (c) => {
      const otherId = c.userAId === user.id ? c.userBId : c.userAId
      const [other] = await db.select().from(users).where(eq(users.id, otherId)).limit(1)
      const [last] = await db.select().from(messages).where(eq(messages.conversationId, c.id)).orderBy(desc(messages.createdAt)).limit(1)
      return { id: c.id, intent: c.intent, with: publicSelf(other!), last: last ?? null }
    }))
    return { conversations: out.sort((x, y) => +(y.last?.createdAt ?? 0) - +(x.last?.createdAt ?? 0)) }
  }, { query: t.Object({ intent: Intent }) })
  .get('/conversations/:id/messages', async ({ user, params, status }) => {
    if (!(await myConversation(user.id, params.id))) return status(404, { error: 'not_found' })
    return { messages: await db.select().from(messages).where(eq(messages.conversationId, params.id)).orderBy(messages.createdAt).limit(200) }
  })
  .post('/conversations/:id/messages', async ({ user, params, body, status }) => {
    const conv = await myConversation(user.id, params.id)
    if (!conv) return status(404, { error: 'not_found' })
    if (body.kind === 'meetup') {
      if (!body.where || !body.when || !(CAMPUS_SPOTS as readonly string[]).includes(body.where)) return status(422, { error: 'public_campus_spot_required' })
      if (new Date(body.when) < new Date()) return status(422, { error: 'time_in_past' })
    } else if (!body.body?.trim()) return status(422, { error: 'empty' })
    const [msg] = await db.insert(messages).values(body.kind === 'meetup'
      ? { conversationId: conv.id, senderId: user.id, kind: 'meetup', meetupWhere: body.where, meetupWhen: new Date(body.when!), meetupStatus: 'pending' }
      : { conversationId: conv.id, senderId: user.id, kind: 'text', body: body.body!.trim() }).returning()
    const otherId = conv.userAId === user.id ? conv.userBId : conv.userAId
    bus.publish(topics.user(otherId), { type: 'message.new', conversationId: conv.id, intent: conv.intent, message: msg })
    return { message: msg }
  }, { body: t.Object({ kind: t.Union([t.Literal('text'), t.Literal('meetup')]), body: t.Optional(t.String({ maxLength: 2000 })), where: t.Optional(t.String()), when: t.Optional(t.String({ format: 'date-time' })) }) })
  // Only the recipient of a proposal can confirm or decline it.
  .patch('/messages/:id/meetup', async ({ user, params, body, status }) => {
    const [row] = await db.select({ m: messages, c: conversations }).from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId)).where(eq(messages.id, params.id)).limit(1)
    if (!row || row.m.kind !== 'meetup' || row.m.senderId === user.id || ![row.c.userAId, row.c.userBId].includes(user.id)) return status(404, { error: 'not_found' })
    if (row.m.meetupStatus !== 'pending') return status(409, { error: 'already_resolved' })
    const [msg] = await db.update(messages).set({ meetupStatus: body.status }).where(eq(messages.id, params.id)).returning()
    bus.publish(topics.user(row.m.senderId), { type: 'meetup.updated', conversationId: row.c.id, message: msg })
    return { message: msg }
  }, { body: t.Object({ status: t.Union([t.Literal('confirmed'), t.Literal('declined')]) }) })
  .get('/spots', () => ({ spots: CAMPUS_SPOTS }))
