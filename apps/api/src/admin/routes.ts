import { Elysia, t } from 'elysia'
import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import {
  adminAudit, adminUsers, blocks, connectionRequests, conversations, intentProfiles, messages,
  moderationActions, reports, roomMembers, rooms, sessions, userProgress, users,
} from '@moc/db'
import { db, redis } from '../context'
import { deleteAccount } from '../account'
import { ledgerOf } from '../rewards/engine'
import { badgesForStaff } from '../rewards/badges'
import { recentRequests } from '../metrics'
import * as presence from '../presence'
import { adminAuthed, audit } from './session'

const uuid = t.String({ format: 'uuid' })
const maskEmail = (e: string) => { const [l = '', d = ''] = e.split('@'); return `${l.slice(0, 2)}${'*'.repeat(Math.max(1, l.length - 2))}@${d}` }
const person = (u: { id: string; name: string; department: string; level: number; university: string; status: string }) =>
  ({ id: u.id, name: u.name, department: u.department, level: u.level, university: u.university, status: u.status })

/** Suspend: flag the account, kill every session, drop presence. Used by report resolution and direct action. */
export async function suspendUser(userId: string, reason: string) {
  const [u] = await db.update(users).set({ status: 'suspended', suspendedAt: new Date(), suspendedReason: reason }).where(eq(users.id, userId)).returning()
  if (!u) return null
  await db.delete(sessions).where(eq(sessions.userId, userId))
  await presence.leave(u.university, u.id)
  return u
}

type Day = { day: string; n: number }
/** Per-day counts for the last `days` days, zero-filled. `source` yields (ts, uid?) rows. */
async function series(source: ReturnType<typeof sql>, days: number): Promise<Day[]> {
  const rows = await db.execute(sql`
    select to_char(d, 'YYYY-MM-DD') as day, coalesce(count(s.ts), 0)::int as n
    from generate_series(date_trunc('day', now()) - ((${days} - 1) * interval '1 day'), date_trunc('day', now()), interval '1 day') d
    left join (${source}) s on date_trunc('day', s.ts) = d
    group by d order by d`)
  return rows as unknown as Day[]
}

export const adminRoutes = new Elysia({ prefix: '/admin' }).use(adminAuthed)
  // ---------------- Overview ----------------
  .get('/overview', async ({ query }) => {
    const days = query.days ?? 14
    const [totalUsers, suspended, openReports] = await Promise.all([
      db.select({ n: count() }).from(users), db.select({ n: count() }).from(users).where(eq(users.status, 'suspended')),
      db.select({ n: count() }).from(reports).where(eq(reports.status, 'open')),
    ])
    const modeRows = await db.select({ intent: intentProfiles.intent, n: count() }).from(intentProfiles).where(eq(intentProfiles.enabled, true)).groupBy(intentProfiles.intent)
    const campusRows = await db.select({ university: users.university, n: count() }).from(users).groupBy(users.university)
    const campuses = await Promise.all(campusRows.map(async (c) => ({ university: c.university, students: c.n, onCampusNow: await presence.count(c.university) })))
    // now() is evaluated by Postgres: a JS Date interpolated into a raw sql template does not serialize.
    const roomRows = await db.select({ live: sql<number>`count(*) filter (where ${rooms.startsAt} <= now() and ${rooms.endsAt} > now())::int`, upcoming: sql<number>`count(*) filter (where ${rooms.startsAt} > now())::int` }).from(rooms)

    const [signups, activity, msgs, conns, reps] = await Promise.all([
      series(sql`select created_at as ts from users`, days),
      // "Active" = did something: sent a message, a connection request, or asked to join a room.
      series(sql`select distinct on (uid, date_trunc('day', ts)) ts, uid from (
        select created_at as ts, sender_id as uid from messages
        union all select created_at, from_user_id from connection_requests
        union all select created_at, user_id from room_members) a`, days),
      series(sql`select created_at as ts from messages`, days),
      series(sql`select created_at as ts from connection_requests`, days),
      series(sql`select created_at as ts from reports`, days),
    ])
    return {
      totals: {
        students: totalUsers[0]?.n ?? 0, suspended: suspended[0]?.n ?? 0, openReports: openReports[0]?.n ?? 0,
        onCampusNow: campuses.reduce((s, c) => s + c.onCampusNow, 0),
        modes: Object.fromEntries(modeRows.map((m) => [m.intent, m.n])),
        rooms: { live: roomRows[0]?.live ?? 0, upcoming: roomRows[0]?.upcoming ?? 0 },
      },
      campuses, days, series: { signups, activeStudents: activity, messages: msgs, connections: conns, reports: reps },
    }
  }, { query: t.Object({ days: t.Optional(t.Numeric({ minimum: 7, maximum: 90 })) }) })

  // ---------------- Reports + moderation ----------------
  .get('/reports', async ({ query }) => {
    const status = query.status ?? 'open'
    const rows = await db.select().from(reports).where(status === 'all' ? undefined : eq(reports.status, status)).orderBy(desc(reports.createdAt)).limit(query.limit ?? 50).offset(query.offset ?? 0)
    // Either side may have deleted their account since: those links are empty, and the report stays.
    const ids = [...new Set(rows.flatMap((r) => [r.reporterId, r.reportedId]).filter((x): x is string => !!x))]
    const people = ids.length ? await db.select().from(users).where(inArray(users.id, ids)) : []
    const against = ids.length ? await db.select({ id: reports.reportedId, n: count() }).from(reports).where(inArray(reports.reportedId, ids)).groupBy(reports.reportedId) : []
    const by = (id: string | null) => (id ? people.find((p) => p.id === id) : undefined)
    return {
      reports: rows.map((r) => ({
        id: r.id, reason: r.reason, details: r.details, intent: r.intent, status: r.status, createdAt: r.createdAt, reviewedAt: r.reviewedAt,
        messageSnapshot: r.messageSnapshot,
        reporter: by(r.reporterId) ? person(by(r.reporterId)!) : null,
        reported: by(r.reportedId) ? { ...person(by(r.reportedId)!), reportsAgainst: against.find((a) => a.id === r.reportedId)?.n ?? 0 } : null,
        reporterDeleted: !r.reporterId, reportedDeleted: !r.reportedId, reportedLabel: r.reportedLabel,
      })),
    }
  }, { query: t.Object({ status: t.Optional(t.Union([t.Literal('open'), t.Literal('reviewed'), t.Literal('dismissed'), t.Literal('all')])), limit: t.Optional(t.Numeric({ maximum: 100 })), offset: t.Optional(t.Numeric()) }) })

  .post('/reports/:id/resolve', async ({ admin, params, body, ip, status }) => {
    if ((body.action === 'warn' || body.action === 'suspend') && body.note.trim().length < 5) return status(422, { error: 'note_required' })
    const [report] = await db.select().from(reports).where(eq(reports.id, params.id)).limit(1)
    if (!report) return status(404, { error: 'not_found' })
    if (report.status !== 'open') return status(409, { error: 'already_resolved' })
    // Claim the report atomically so two staff members cannot both act on it.
    const [claimed] = await db.update(reports).set({ status: body.action === 'dismiss' ? 'dismissed' : 'reviewed', reviewedBy: admin.id, reviewedAt: new Date() })
      .where(and(eq(reports.id, report.id), eq(reports.status, 'open'))).returning()
    if (!claimed) return status(409, { error: 'already_resolved' })
    await db.insert(moderationActions).values({ adminId: admin.id, userId: report.reportedId, reportId: report.id, action: body.action, note: body.note.trim() })
    // If the reported person has since deleted their account there is nobody left to suspend; the report is still closed on record.
    if (body.action === 'suspend' && report.reportedId) await suspendUser(report.reportedId, body.note.trim())
    await audit(admin.id, `report.${body.action}`, { targetType: 'report', targetId: report.id, meta: { userId: report.reportedId }, ip })
    return { ok: true }
  }, { params: t.Object({ id: uuid }), body: t.Object({ action: t.Union([t.Literal('dismiss'), t.Literal('warn'), t.Literal('suspend')]), note: t.String({ maxLength: 1000 }) }) })

  // ---------------- Users ----------------
  .get('/users', async ({ admin, query, ip }) => {
    const q = query.q?.trim() ?? ''
    const where = q
      ? or(ilike(users.name, `%${q.replace(/[%_]/g, '')}%`), ilike(users.email, `%${q.replace(/[%_]/g, '')}%`), /^[0-9a-f-]{36}$/i.test(q) ? eq(users.id, q) : undefined)
      : undefined
    const rows = await db.select().from(users).where(and(where, query.status ? eq(users.status, query.status) : undefined)).orderBy(desc(users.createdAt)).limit(25)
    if (q) await audit(admin.id, 'user.search', { meta: { q: q.slice(0, 60), results: rows.length }, ip })
    return { users: rows.map((u) => ({ ...person(u), emailMasked: maskEmail(u.email), createdAt: u.createdAt })) }
  }, { query: t.Object({ q: t.Optional(t.String({ maxLength: 100 })), status: t.Optional(t.Union([t.Literal('active'), t.Literal('suspended')])) }) })

  .get('/users/:id', async ({ admin, params, ip, status }) => {
    const [u] = await db.select().from(users).where(eq(users.id, params.id)).limit(1)
    if (!u) return status(404, { error: 'not_found' })
    await audit(admin.id, 'user.view', { targetType: 'user', targetId: u.id, ip })
    const asReporter = (col: typeof reports.reporterId | typeof reports.reportedId) => db.select({ n: count() }).from(reports).where(eq(col, u.id))
    const [profiles, msgCount, sentReq, recvReq, convs, hosted, joined, blocksGiven, blocksReceived, filed, againstRows, actions, sess, lastMsg] = await Promise.all([
      db.select().from(intentProfiles).where(eq(intentProfiles.userId, u.id)),
      db.select({ n: count() }).from(messages).where(eq(messages.senderId, u.id)),
      db.select({ n: count() }).from(connectionRequests).where(eq(connectionRequests.fromUserId, u.id)),
      db.select({ n: count() }).from(connectionRequests).where(eq(connectionRequests.toUserId, u.id)),
      db.select({ intent: conversations.intent, n: count() }).from(conversations).where(or(eq(conversations.userAId, u.id), eq(conversations.userBId, u.id))).groupBy(conversations.intent),
      db.select({ n: count() }).from(rooms).where(eq(rooms.hostId, u.id)),
      db.select({ n: count() }).from(roomMembers).where(and(eq(roomMembers.userId, u.id), eq(roomMembers.status, 'approved'))),
      db.select({ n: count() }).from(blocks).where(eq(blocks.blockerId, u.id)),
      db.select({ n: count() }).from(blocks).where(eq(blocks.blockedId, u.id)),
      asReporter(reports.reporterId),
      db.select().from(reports).where(eq(reports.reportedId, u.id)).orderBy(desc(reports.createdAt)).limit(20),
      db.select().from(moderationActions).where(eq(moderationActions.userId, u.id)).orderBy(desc(moderationActions.createdAt)).limit(20),
      db.select({ n: count() }).from(sessions).where(eq(sessions.userId, u.id)),
      db.select({ at: sql<Date | null>`max(${messages.createdAt})` }).from(messages).where(eq(messages.senderId, u.id)),
    ])
    // Points and streak: a ledger of what was earned and why, who invited this student, and who they invited.
    const [prog] = await db.select().from(userProgress).where(eq(userProgress.userId, u.id)).limit(1)
    const [referrer] = u.referredBy ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, u.referredBy)).limit(1) : []
    const [invitedCount] = await db.select({ n: count() }).from(users).where(eq(users.referredBy, u.id))
    const rewards = { points: prog?.pointsTotal ?? 0, streakCurrent: prog?.streakCurrent ?? 0, streakBest: prog?.streakBest ?? 0, lastActiveDay: prog?.lastActiveDay ?? null, referredBy: referrer ?? null, invited: invitedCount?.n ?? 0, ledger: await ledgerOf(u.id), badges: await badgesForStaff(u.id) }
    // Staff see counts and metadata about conversations, never their content. Only report snapshots carry text.
    return {
      rewards,
      user: { ...person(u), email: u.email, createdAt: u.createdAt, verifiedAt: u.verifiedAt, suspendedAt: u.suspendedAt, suspendedReason: u.suspendedReason },
      profiles: profiles.map((p) => ({ intent: p.intent, enabled: p.enabled, prompt: p.prompt, tags: p.tags, hideFromDepartment: p.hideFromDepartment })),
      activity: {
        messagesSent: msgCount[0]?.n ?? 0, connectionsSent: sentReq[0]?.n ?? 0, connectionsReceived: recvReq[0]?.n ?? 0,
        conversations: Object.fromEntries(convs.map((c) => [c.intent, c.n])), roomsHosted: hosted[0]?.n ?? 0, roomsJoined: joined[0]?.n ?? 0,
        activeSessions: sess[0]?.n ?? 0, lastMessageAt: lastMsg[0]?.at ?? null,
      },
      safety: { blocksGiven: blocksGiven[0]?.n ?? 0, blocksReceived: blocksReceived[0]?.n ?? 0, reportsFiled: filed[0]?.n ?? 0 },
      reportsAgainst: againstRows.map((r) => ({ id: r.id, reason: r.reason, status: r.status, createdAt: r.createdAt })),
      moderation: actions.map((a) => ({ id: a.id, action: a.action, note: a.note, createdAt: a.createdAt, reportId: a.reportId })),
    }
  }, { params: t.Object({ id: uuid }) })

  // Delete an account on a student's request (for example by email). Typing their email guards against the wrong person;
  // the written reason goes in the audit log, which never stores the email or name.
  .post('/users/:id/delete', async ({ admin, params, body, ip, status }) => {
    const [u] = await db.select().from(users).where(eq(users.id, params.id)).limit(1)
    if (!u) return status(404, { error: 'not_found' })
    if (body.confirmEmail.trim().toLowerCase() !== u.email.toLowerCase()) return status(422, { error: 'confirm_mismatch' })
    if (body.reason.trim().length < 5) return status(422, { error: 'reason_required' })
    await deleteAccount(u.id, { kind: 'staff', adminId: admin.id, reason: body.reason.trim(), ip })
    return { ok: true }
  }, { params: t.Object({ id: uuid }), body: t.Object({ confirmEmail: t.String({ maxLength: 254 }), reason: t.String({ maxLength: 300 }) }) })

  .post('/users/:id/suspend', async ({ admin, params, body, ip, status }) => {
    if (body.note.trim().length < 5) return status(422, { error: 'note_required' })
    const u = await suspendUser(params.id, body.note.trim())
    if (!u) return status(404, { error: 'not_found' })
    await db.insert(moderationActions).values({ adminId: admin.id, userId: u.id, action: 'suspend', note: body.note.trim() })
    await audit(admin.id, 'user.suspend', { targetType: 'user', targetId: u.id, ip })
    return { ok: true }
  }, { params: t.Object({ id: uuid }), body: t.Object({ note: t.String({ maxLength: 1000 }) }) })
  .post('/users/:id/unsuspend', async ({ admin, params, body, ip, status }) => {
    if (body.note.trim().length < 5) return status(422, { error: 'note_required' })
    const [u] = await db.update(users).set({ status: 'active', suspendedAt: null, suspendedReason: null }).where(eq(users.id, params.id)).returning()
    if (!u) return status(404, { error: 'not_found' })
    await db.insert(moderationActions).values({ adminId: admin.id, userId: u.id, action: 'unsuspend', note: body.note.trim() })
    await audit(admin.id, 'user.unsuspend', { targetType: 'user', targetId: u.id, ip })
    return { ok: true }
  }, { params: t.Object({ id: uuid }), body: t.Object({ note: t.String({ maxLength: 1000 }) }) })

  // ---------------- Live activity feed (no message content, no emails) ----------------
  .get('/activity', async () => {
    const [signups, newRooms, newReports, actions] = await Promise.all([
      db.select().from(users).orderBy(desc(users.createdAt)).limit(20),
      db.select().from(rooms).orderBy(desc(rooms.createdAt)).limit(20),
      db.select().from(reports).orderBy(desc(reports.createdAt)).limit(20),
      db.select().from(moderationActions).orderBy(desc(moderationActions.createdAt)).limit(20),
    ])
    const events = [
      ...signups.map((u) => ({ at: u.createdAt, kind: 'signup' as const, text: `${u.name} joined (${u.university}, ${u.department} ${u.level}L)`, link: `/users/${u.id}` })),
      ...newRooms.map((r) => ({ at: r.createdAt, kind: 'room' as const, text: `New ${r.intent} room "${r.title}" at ${r.place}`, link: null })),
      ...newReports.map((r) => ({ at: r.createdAt, kind: 'report' as const, text: `Report: ${r.reason.replace('_', ' ')} (${r.status})`, link: `/reports` })),
      ...actions.map((a) => ({ at: a.createdAt, kind: 'moderation' as const, text: `Moderation: ${a.action}`, link: `/users/${a.userId}` })),
    ].sort((a, b) => +b.at - +a.at).slice(0, 40)
    return { events }
  })

  // ---------------- Health ----------------
  .get('/health', async () => {
    const time = async <T>(fn: () => Promise<T>) => { const s = performance.now(); try { await fn(); return { ok: true, ms: Math.round(performance.now() - s) } } catch { return { ok: false, ms: null } } }
    const [dbHealth, redisHealth, requests] = await Promise.all([time(() => db.execute(sql`select 1`)), time(() => redis.ping()), recentRequests(60)])
    const total = requests.reduce((s, m) => s + m.requests, 0), errors = requests.reduce((s, m) => s + m.serverErrors, 0)
    return {
      api: { ok: true, uptimeSeconds: Math.round(process.uptime()), runtime: `Bun ${Bun.version}`, memoryMb: Math.round(process.memoryUsage.rss() / 1048576) },
      postgres: dbHealth, redis: redisHealth,
      requests: { lastHour: total, serverErrors: errors, errorRate: total ? errors / total : 0, perMinute: requests },
    }
  })

  .get('/audit', async ({ query }) => {
    const rows = await db.select({ a: adminAudit, email: adminUsers.email }).from(adminAudit).leftJoin(adminUsers, eq(adminUsers.id, adminAudit.adminId)).orderBy(desc(adminAudit.createdAt)).limit(query.limit ?? 100)
    return { entries: rows.map((r) => ({ id: r.a.id, at: r.a.createdAt, admin: r.email, action: r.a.action, targetType: r.a.targetType, targetId: r.a.targetId, meta: r.a.meta, ip: r.a.ip })) }
  }, { query: t.Object({ limit: t.Optional(t.Numeric({ maximum: 500 })) }) })
