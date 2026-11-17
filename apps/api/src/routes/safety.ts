import { Elysia, t } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { blocks, conversations, messages, reports, users } from '@moc/db'
import { authed, publicSelf } from '../auth'
import { db } from '../context'
import { hit } from '../ratelimit'

const Reason = t.Union([t.Literal('harassment'), t.Literal('spam'), t.Literal('fake_profile'), t.Literal('inappropriate'), t.Literal('unsafe'), t.Literal('other')])

export const safetyRoutes = new Elysia().use(authed)
  .get('/blocks', async ({ user }) => {
    const rows = await db.select({ u: users, at: blocks.createdAt }).from(blocks)
      .innerJoin(users, eq(users.id, blocks.blockedId)).where(eq(blocks.blockerId, user.id))
    return { blocked: rows.map((r) => ({ ...publicSelf(r.u), blockedAt: r.at })) }
  })
  .post('/blocks', async ({ user, body, status }) => {
    if (body.userId === user.id) return status(422, { error: 'cannot_block_self' })
    const [target] = await db.select().from(users).where(eq(users.id, body.userId)).limit(1)
    if (!target || target.university !== user.university) return status(404, { error: 'not_found' })
    await db.insert(blocks).values({ blockerId: user.id, blockedId: target.id }).onConflictDoNothing()
    return { ok: true }
  }, { body: t.Object({ userId: t.String({ format: 'uuid' }) }) })
  .delete('/blocks/:userId', async ({ user, params }) => {
    await db.delete(blocks).where(and(eq(blocks.blockerId, user.id), eq(blocks.blockedId, params.userId)))
    return { ok: true }
  })
  .post('/reports', async ({ user, body, status, set }) => {
    if (body.userId === user.id) return status(422, { error: 'cannot_report_self' })
    const wait = await hit(`report:${user.id}`, 10, 86_400)
    if (wait) { set.headers['retry-after'] = String(wait); return status(429, { error: 'too_many_requests', retryAfter: wait }) }
    const [target] = await db.select().from(users).where(eq(users.id, body.userId)).limit(1)
    if (!target || target.university !== user.university) return status(404, { error: 'not_found' })

    let intent: 'study' | 'friends' | 'romance' | null = body.intent ?? null
    let messageId: string | null = null
    let snapshot: string | null = null
    if (body.messageId) {
      // Only a message from a conversation the reporter is in, sent by the reported person.
      const [row] = await db.select({ m: messages, c: conversations }).from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId)).where(eq(messages.id, body.messageId)).limit(1)
      const inConv = row && [row.c.userAId, row.c.userBId].includes(user.id) && row.m.senderId === target.id
      if (!inConv) return status(404, { error: 'message_not_found' })
      messageId = row.m.id; intent = row.c.intent
      snapshot = row.m.kind === 'text' ? row.m.body : `Meetup proposal: ${row.m.meetupWhere}`
    }
    const [report] = await db.insert(reports).values({ reporterId: user.id, reportedId: target.id, reason: body.reason, details: body.details ?? '', intent, messageId, messageSnapshot: snapshot }).returning()
    if (body.alsoBlock) await db.insert(blocks).values({ blockerId: user.id, blockedId: target.id }).onConflictDoNothing()
    return { id: report!.id }
  }, { body: t.Object({
    userId: t.String({ format: 'uuid' }), reason: Reason, details: t.Optional(t.String({ maxLength: 1000 })),
    messageId: t.Optional(t.String({ format: 'uuid' })), intent: t.Optional(t.Union([t.Literal('study'), t.Literal('friends'), t.Literal('romance')])),
    alsoBlock: t.Optional(t.Boolean()),
  }) })
