import { Elysia, t } from 'elysia'
import { and, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm'
import { blocks, roomMembers, rooms, users } from '@moc/db'
import { authed, publicSelf } from '../auth'
import { limited } from '../ratelimit'
import { bus, db, topics } from '../context'
import { blockedWith, isBlockedBetween } from '../blocks'
import { onRoomMemberApproved } from '../rewards/events'
import { isPremium } from '../premium'
import { livekit, roomName } from '../livekit'

const ONLINE_MAX_MS = 4 * 3600_000
/** The most spots a room can have. Also the call's LiveKit participant limit: approval decides who gets a token, and LiveKit only applies the limit when it first creates the room. */
export const ROOM_CAPACITY_MAX = 50

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
  .post('/', async ({ user, body, status, set }) => {
    const over = await limited(user.id, 'roomCreate', set); if (over) return status(429, over)
    const startsAt = new Date(body.startsAt), endsAt = new Date(body.endsAt)
    if (!(endsAt > startsAt) || endsAt < new Date()) return status(422, { error: 'bad_time_range' })
    const mode = body.mode ?? 'physical'
    if (mode === 'online') {
      if (!isPremium(user)) return status(403, { error: 'premium_required' })
      if (!livekit.configured()) return status(503, { error: 'online_unavailable' })
      if (endsAt.getTime() - startsAt.getTime() > ONLINE_MAX_MS) return status(422, { error: 'online_too_long' })
    } else if (!body.place?.trim()) return status(422, { error: 'place_required' })
    const place = mode === 'online' ? 'Online' : body.place!
    const room = await db.transaction(async (tx) => {
      const [r] = await tx.insert(rooms).values({ ...body, mode, place, startsAt, endsAt, hostId: user.id, university: user.university }).returning()
      await tx.insert(roomMembers).values({ roomId: r!.id, userId: user.id, status: 'approved', decisionSeenAt: new Date() })
      return r!
    })
    bus.publish(topics.campus(user.university), { type: 'room.created', roomId: room.id, intent: room.intent })
    return { room }
  }, { body: t.Object({ intent: RoomIntent, tag: t.String({ maxLength: 24 }), title: t.String({ maxLength: 80 }), mode: t.Optional(t.Union([t.Literal('physical'), t.Literal('online')])), place: t.Optional(t.String({ maxLength: 80 })), startsAt: t.String({ format: 'date-time' }), endsAt: t.String({ format: 'date-time' }), capacity: t.Integer({ minimum: 2, maximum: ROOM_CAPACITY_MAX }) }) })
  .post('/:id/request', async ({ user, params, status, set }) => {
    const over = await limited(user.id, 'roomRequest', set); if (over) return status(429, over)
    const [room] = await db.select().from(rooms).where(and(eq(rooms.id, params.id), eq(rooms.university, user.university))).limit(1)
    if (!room || room.cancelledAt || room.endsAt < new Date() || (await isBlockedBetween(user.id, room.hostId))) return status(404, { error: 'not_found' })
    await db.insert(roomMembers).values({ roomId: room.id, userId: user.id, status: 'pending' }).onConflictDoNothing()
    bus.publish(topics.user(room.hostId), { type: 'room.request', roomId: room.id, from: publicSelf(user) })
    return { status: 'pending' }
  })
  // Join the live call of an online room. Order matters and every refusal happens before a token exists: this endpoint is the only door into the call.
  .post('/:id/join', async ({ user, params, body, status, set }) => {
    const over = await limited(user.id, 'roomJoin', set); if (over) return status(429, over)
    const [room] = await db.select().from(rooms).where(and(eq(rooms.id, params.id), eq(rooms.university, user.university), eq(rooms.mode, 'online'))).limit(1)
    if (!room || (await isBlockedBetween(user.id, room.hostId))) return status(404, { error: 'not_found' })
    if (room.cancelledAt) return status(409, { error: 'cancelled' })
    const [m] = await db.select().from(roomMembers).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, user.id), eq(roomMembers.status, 'approved'))).limit(1)
    if (!m) return status(403, { error: 'not_a_member' })
    const now = new Date()
    if (now < room.startsAt) return status(409, { error: 'not_live_yet' })
    if (now >= room.endsAt) return status(409, { error: 'ended' })
    if (!livekit.configured()) return status(503, { error: 'online_unavailable' })
    const name = roomName(room.id)
    try {
      const present = await livekit.participants(name)
      if (!body?.acknowledgeBlocked && present.length) {
        const mine = await db.select({ id: blocks.blockedId }).from(blocks).where(and(eq(blocks.blockerId, user.id), inArray(blocks.blockedId, present.map((p) => p.identity))))
        const ids = new Set(mine.map((b) => b.id))
        const people = present.filter((p) => ids.has(p.identity)).map((p) => ({ name: p.name }))
        if (people.length) return status(409, { error: 'blocked_present', people })
      }
      await livekit.ensureRoom(name, ROOM_CAPACITY_MAX)
      const token = await livekit.issueToken({ room: name, identity: user.id, name: user.name, expiresAt: room.endsAt })
      return { url: livekit.url(), token }
    } catch (e) {
      console.error('room join: voice provider failed:', e instanceof Error ? e.message : 'unknown error')
      return status(502, { error: 'voice_unavailable' })
    }
  }, { params: t.Object({ id: t.String({ format: 'uuid' }) }), body: t.Optional(t.Object({ acknowledgeBlocked: t.Optional(t.Boolean()) })) })
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

  // Host: remove an approved member from an online room. They are declined (which frees the place and stops them asking again) and disconnected.
  .post('/:id/members/:userId/remove', async ({ user, params, status }) => {
    const [room] = await db.select().from(rooms).where(eq(rooms.id, params.id)).limit(1)
    if (!room || room.mode !== 'online') return status(404, { error: 'not_found' })
    if (room.hostId !== user.id) return status(403, { error: 'host_only' })
    if (params.userId === user.id) return status(422, { error: 'cannot_remove_host' })
    const [m] = await db.update(roomMembers).set({ status: 'declined', decisionSeenAt: null })
      .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, params.userId), eq(roomMembers.status, 'approved'))).returning()
    if (!m) {
      // Already declined: this is a retry of a disconnect that failed. Only the disconnect is attempted again.
      const [prev] = await db.select().from(roomMembers).where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, params.userId), eq(roomMembers.status, 'declined'))).limit(1)
      if (!prev) return status(404, { error: 'not_found' })
    }
    if (m) bus.publish(topics.user(params.userId), { type: 'room.decision', roomId: room.id, decision: 'declined' })
    try { await livekit.removeParticipant(roomName(room.id), params.userId) } catch (e) {
      console.error('room remove: disconnecting failed:', e instanceof Error ? e.message : 'unknown error')
      return status(502, { error: 'voice_unavailable' })
    }
    return { ok: true }
  }, { params: t.Object({ id: t.String({ format: 'uuid' }), userId: t.String({ format: 'uuid' }) }) })

  // Host: change a room's details. Everyone who has a place is told. Capacity cannot drop below the people already in.
  .patch('/:id', async ({ user, params, body, status, set }) => {
    const over = await limited(user.id, 'roomEdit', set); if (over) return status(429, over)
    const out = await db.transaction(async (tx) => {
      const [room] = await tx.select().from(rooms).where(and(eq(rooms.id, params.id), eq(rooms.hostId, user.id))).for('update').limit(1)
      if (!room) return { code: 403 as const, error: 'host_only' }
      if (room.cancelledAt) return { code: 409 as const, error: 'cancelled' }
      const startsAt = body.startsAt ? new Date(body.startsAt) : room.startsAt
      const endsAt = body.endsAt ? new Date(body.endsAt) : room.endsAt
      if (!(endsAt > startsAt) || endsAt < new Date()) return { code: 422 as const, error: 'bad_time_range' }
      if (room.mode === 'online') {
        if (body.place !== undefined) return { code: 422 as const, error: 'place_locked' }
        if (endsAt.getTime() - startsAt.getTime() > ONLINE_MAX_MS) return { code: 422 as const, error: 'online_too_long' }
      }
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
    startsAt: t.Optional(t.String({ format: 'date-time' })), endsAt: t.Optional(t.String({ format: 'date-time' })), capacity: t.Optional(t.Integer({ minimum: 1, maximum: ROOM_CAPACITY_MAX })),
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
    if (out.room.mode === 'online') {
      try { await livekit.closeRoom(roomName(out.room.id)) } catch (e) { console.error('room cancel: closing the call failed:', e instanceof Error ? e.message : 'unknown error') }
    }
    for (const id of out.people) bus.publish(topics.user(id), { type: 'room.cancelled', roomId: out.room.id, title: out.room.title })
    bus.publish(topics.campus(user.university), { type: 'room.changed', roomId: out.room.id, intent: out.room.intent })
    return { ok: true }
  }, { params: t.Object({ id: t.String({ format: 'uuid' }) }) })

  // I have looked at my rooms: answers and cancellations are no longer news.
  .post('/seen', async ({ user }) => {
    await db.update(roomMembers).set({ decisionSeenAt: new Date() }).where(and(eq(roomMembers.userId, user.id), isNull(roomMembers.decisionSeenAt)))
    return { ok: true }
  })
