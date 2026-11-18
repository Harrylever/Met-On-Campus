import { Elysia, t } from 'elysia'
import { and, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm'
import { roomMembers, rooms, users } from '@moc/db'
import { authed, publicSelf } from '../auth'
import { bus, db, topics } from '../context'
import { blockedWith, isBlockedBetween } from '../blocks'
import { onRoomMemberApproved } from '../rewards/events'

const RoomIntent = t.Union([t.Literal('study'), t.Literal('friends')])

export const roomRoutes = new Elysia({ prefix: '/rooms' }).use(authed)
  .get('/', async ({ user, query }) => {
    const now = new Date()
    const blocked = await blockedWith(user.id)
    const list = (await db.select().from(rooms)
      .where(and(eq(rooms.university, user.university), eq(rooms.intent, query.intent), gt(rooms.endsAt, now)))
      .orderBy(rooms.startsAt)).filter((r) => !blocked.has(r.hostId))
    const members = list.length ? await db.select({ m: roomMembers, u: users }).from(roomMembers).innerJoin(users, eq(users.id, roomMembers.userId)).where(inArray(roomMembers.roomId, list.map((r) => r.id))) : []
    return {
      rooms: list.flatMap((r) => {
        const mem = members.filter((x) => x.m.roomId === r.id)
        const approved = mem.filter((x) => x.m.status === 'approved')
        const host = mem.find((x) => x.u.id === r.hostId)?.u
        const mine = mem.find((x) => x.m.userId === user.id)?.m.status ?? null
        // A cancelled room stays visible only to people who had a place or were waiting, so they learn what happened.
        if (r.cancelledAt && (r.hostId === user.id || (mine !== 'approved' && mine !== 'pending'))) return []
        const myRow = mem.find((x) => x.m.userId === user.id)?.m
        return [{
          ...r, live: !r.cancelledAt && r.startsAt <= now, taken: approved.length, host: host ? publicSelf(host) : null,
          attendees: approved.map((x) => x.u.name), myStatus: mine, isHost: r.hostId === user.id, cancelled: !!r.cancelledAt,
          // News the member has not looked at yet: an answer to their request, or a cancellation.
          decisionUnseen: !!myRow && r.hostId !== user.id && myRow.decisionSeenAt == null && (myRow.status !== 'pending' || !!r.cancelledAt),
          pendingCount: r.hostId === user.id ? mem.filter((x) => x.m.status === 'pending').length : undefined,
        }]
      }),
    }
  }, { query: t.Object({ intent: RoomIntent }) })
  .post('/', async ({ user, body, status }) => {
    const startsAt = new Date(body.startsAt), endsAt = new Date(body.endsAt)
    if (!(endsAt > startsAt) || endsAt < new Date()) return status(422, { error: 'bad_time_range' })
    const room = await db.transaction(async (tx) => {
      const [r] = await tx.insert(rooms).values({ ...body, startsAt, endsAt, hostId: user.id, university: user.university }).returning()
      await tx.insert(roomMembers).values({ roomId: r!.id, userId: user.id, status: 'approved', decisionSeenAt: new Date() })
      return r!
    })
    bus.publish(topics.campus(user.university), { type: 'room.created', roomId: room.id, intent: room.intent })
    return { room }
  }, { body: t.Object({ intent: RoomIntent, tag: t.String({ maxLength: 24 }), title: t.String({ maxLength: 80 }), place: t.String({ maxLength: 80 }), startsAt: t.String({ format: 'date-time' }), endsAt: t.String({ format: 'date-time' }), capacity: t.Integer({ minimum: 2, maximum: 50 }) }) })
  .post('/:id/request', async ({ user, params, status }) => {
    const [room] = await db.select().from(rooms).where(and(eq(rooms.id, params.id), eq(rooms.university, user.university))).limit(1)
    if (!room || room.cancelledAt || room.endsAt < new Date() || (await isBlockedBetween(user.id, room.hostId))) return status(404, { error: 'not_found' })
    await db.insert(roomMembers).values({ roomId: room.id, userId: user.id, status: 'pending' }).onConflictDoNothing()
    bus.publish(topics.user(room.hostId), { type: 'room.request', roomId: room.id, from: publicSelf(user) })
    return { status: 'pending' }
  })
  .delete('/:id/request', async ({ user, params }) => {
    await db.delete(roomMembers).where(and(eq(roomMembers.roomId, params.id), eq(roomMembers.userId, user.id), eq(roomMembers.status, 'pending')))
    return { ok: true }
  })
  .get('/:id/requests', async ({ user, params, status }) => {
    const [room] = await db.select().from(rooms).where(and(eq(rooms.id, params.id), eq(rooms.hostId, user.id))).limit(1)
    if (!room) return status(403, { error: 'host_only' })
    const rows = await db.select({ u: users }).from(roomMembers).innerJoin(users, eq(users.id, roomMembers.userId))
      .where(and(eq(roomMembers.roomId, params.id), eq(roomMembers.status, 'pending')))
    return { requests: rows.map((r) => publicSelf(r.u)) }
  })
  // Host decision. Capacity is checked under a row lock so two approvals can't overfill the room.
  .post('/:id/requests/:userId', async ({ user, params, body, status }) => {
    const out = await db.transaction(async (tx) => {
      const [room] = await tx.select().from(rooms).where(and(eq(rooms.id, params.id), eq(rooms.hostId, user.id))).for('update').limit(1)
      if (!room) return { code: 403 as const }
      if (room.cancelledAt) return { code: 409 as const, error: 'cancelled' }
      if (body.decision === 'approved') {
        const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(roomMembers).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.status, 'approved')))
        if (n >= room.capacity) return { code: 409 as const, error: 'room_full' }
      }
      const [m] = await tx.update(roomMembers).set({ status: body.decision, decisionSeenAt: null }) // new news for them
        .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, params.userId), eq(roomMembers.status, 'pending'))).returning()
      return m ? { code: 200 as const } : { code: 404 as const }
    })
    if (out.code !== 200) return status(out.code, { error: 'error' in out && out.error ? out.error : 'not_found' })
    if (body.decision === 'approved') await onRoomMemberApproved(params.id, params.userId)
    bus.publish(topics.user(params.userId), { type: 'room.decision', roomId: params.id, decision: body.decision })
    return { ok: true }
  }, { body: t.Object({ decision: t.Union([t.Literal('approved'), t.Literal('declined')]) }) })

  // Host: change a room's details. Everyone who has a place is told. Capacity cannot drop below the people already in.
  .patch('/:id', async ({ user, params, body, status }) => {
    const out = await db.transaction(async (tx) => {
      const [room] = await tx.select().from(rooms).where(and(eq(rooms.id, params.id), eq(rooms.hostId, user.id))).for('update').limit(1)
      if (!room) return { code: 403 as const, error: 'host_only' }
      if (room.cancelledAt) return { code: 409 as const, error: 'cancelled' }
      const startsAt = body.startsAt ? new Date(body.startsAt) : room.startsAt
      const endsAt = body.endsAt ? new Date(body.endsAt) : room.endsAt
      if (!(endsAt > startsAt) || endsAt < new Date()) return { code: 422 as const, error: 'bad_time_range' }
      if (body.capacity !== undefined) {
        const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(roomMembers).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.status, 'approved')))
        if (body.capacity < n) return { code: 409 as const, error: 'capacity_below_members' }
      }
      const [updated] = await tx.update(rooms).set({
        title: body.title ?? room.title, place: body.place ?? room.place, tag: body.tag ?? room.tag, capacity: body.capacity ?? room.capacity, startsAt, endsAt,
      }).where(eq(rooms.id, room.id)).returning()
      const people = await tx.select({ id: roomMembers.userId }).from(roomMembers).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.status, 'approved'), ne(roomMembers.userId, user.id)))
      return { code: 200 as const, room: updated!, people: people.map((p) => p.id) }
    })
    if (out.code !== 200) return status(out.code, { error: out.error })
    for (const id of out.people) bus.publish(topics.user(id), { type: 'room.updated', roomId: out.room.id, title: out.room.title })
    bus.publish(topics.campus(user.university), { type: 'room.changed', roomId: out.room.id, intent: out.room.intent })
    return { room: out.room }
  }, { body: t.Object({
    tag: t.Optional(t.String({ minLength: 1, maxLength: 24 })), title: t.Optional(t.String({ minLength: 1, maxLength: 80 })), place: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
    startsAt: t.Optional(t.String({ format: 'date-time' })), endsAt: t.Optional(t.String({ format: 'date-time' })), capacity: t.Optional(t.Integer({ minimum: 1, maximum: 50 })),
  }) })

  // Host: cancel. The room stays on record; people who had a place or were waiting are told and see it marked cancelled.
  .delete('/:id', async ({ user, params, status }) => {
    const out = await db.transaction(async (tx) => {
      const [room] = await tx.select().from(rooms).where(and(eq(rooms.id, params.id), eq(rooms.hostId, user.id))).for('update').limit(1)
      if (!room) return { code: 403 as const, error: 'host_only' }
      if (room.cancelledAt) return { code: 409 as const, error: 'cancelled' }
      await tx.update(rooms).set({ cancelledAt: new Date() }).where(eq(rooms.id, room.id))
      const people = await tx.update(roomMembers).set({ decisionSeenAt: null })
        .where(and(eq(roomMembers.roomId, room.id), ne(roomMembers.userId, user.id), inArray(roomMembers.status, ['approved', 'pending']))).returning({ id: roomMembers.userId })
      return { code: 200 as const, room, people: people.map((p) => p.id) }
    })
    if (out.code !== 200) return status(out.code, { error: out.error })
    for (const id of out.people) bus.publish(topics.user(id), { type: 'room.cancelled', roomId: out.room.id, title: out.room.title })
    bus.publish(topics.campus(user.university), { type: 'room.changed', roomId: out.room.id, intent: out.room.intent })
    return { ok: true }
  }, { params: t.Object({ id: t.String({ format: 'uuid' }) }) })

  // I have looked at my rooms: answers and cancellations are no longer news.
  .post('/seen', async ({ user }) => {
    await db.update(roomMembers).set({ decisionSeenAt: new Date() }).where(and(eq(roomMembers.userId, user.id), isNull(roomMembers.decisionSeenAt)))
    return { ok: true }
  })
