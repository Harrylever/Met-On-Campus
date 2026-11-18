import { and, count, desc, eq, gte, inArray, isNull, lt, sql, sum } from 'drizzle-orm'
import { dailyCheckins, intentProfiles, pointEvents, userProgress, users } from '@moc/db'
import { db } from '../context'
import { env } from '../env'
import { DAILY_CAP, INVITES_PER_MONTH, INVITE_ACTIVE_DAYS, REPEATABLE, RULES, STREAK_MILESTONES, type Kind } from './rules'
import { addDays, daysBetween, monthStart, nextMonthStart, watDay, watMonth } from './time'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type Awarded = { kind: Kind; points: number }

/** One person's awards and streak are changed one at a time, so caps and streaks are exact even when requests overlap. */
const lock = (tx: Tx, userId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 7))`)

/**
 * Pays points once for something. `key` says what it was for; the same key never pays twice. Returns null when it did not
 * pay (already paid, or a daily or monthly cap was reached). Must be called with the person's lock held.
 */
async function awardIn(tx: Tx, userId: string, kind: Kind, key: string, day: string): Promise<Awarded | null> {
  const rule = RULES[kind]
  const live = and(eq(pointEvents.userId, userId), isNull(pointEvents.reversedAt))
  if (rule.repeatable) {
    if (rule.perDay) {
      const [n] = await tx.select({ n: count() }).from(pointEvents).where(and(live, eq(pointEvents.kind, kind), eq(pointEvents.day, day)))
      if ((n?.n ?? 0) >= rule.perDay) return null
    }
    const [s] = await tx.select({ s: sum(pointEvents.points) }).from(pointEvents).where(and(live, inArray(pointEvents.kind, REPEATABLE), eq(pointEvents.day, day)))
    if (Number(s?.s ?? 0) + rule.points > DAILY_CAP) return null
  }
  if (kind === 'invite_friend') {
    const month = watMonth(new Date(`${day}T12:00:00Z`))
    const [n] = await tx.select({ n: count() }).from(pointEvents).where(and(live, eq(pointEvents.kind, kind), gte(pointEvents.day, monthStart(month)), lt(pointEvents.day, nextMonthStart(month))))
    if ((n?.n ?? 0) >= INVITES_PER_MONTH) return null
  }
  const [row] = await tx.insert(pointEvents).values({ userId, kind, points: rule.points, key, day }).onConflictDoNothing().returning({ id: pointEvents.id })
  if (!row) return null
  await tx.insert(userProgress).values({ userId, pointsTotal: rule.points })
    .onConflictDoUpdate({ target: userProgress.userId, set: { pointsTotal: sql`${userProgress.pointsTotal} + ${rule.points}`, updatedAt: new Date() } })
  return { kind, points: rule.points }
}

export async function award(userId: string, kind: Kind, key: string, now: Date = new Date()) {
  return db.transaction(async (tx) => { await lock(tx, userId); return awardIn(tx, userId, kind, key, watDay(now)) })
}

// ---- Daily check-in and streaks -------------------------------------------------------------------------------------
const restAvailable = (lastRestOn: string | null, today: string) => !lastRestOn || daysBetween(lastRestOn, today) >= 7

export type CheckIn = { day: string; alreadyCheckedIn: boolean; streak: { current: number; best: number }; restUsed: boolean; awarded: Awarded[]; pointsTotal: number }

/**
 * Opening the app counts once per Nigerian day. Yesterday keeps the streak going. One missed day is forgiven once a week
 * (a "rest day"): many students are on limited data, so a single gap should not erase weeks of effort. Any longer gap, or a
 * second missed day within the week, starts again from 1.
 */
export async function checkIn(userId: string, now: Date = new Date()): Promise<CheckIn> {
  const today = watDay(now)
  const out = await db.transaction(async (tx) => {
    await lock(tx, userId)
    await tx.insert(userProgress).values({ userId }).onConflictDoNothing()
    const [p] = await tx.select().from(userProgress).where(eq(userProgress.userId, userId)).limit(1)
    if (p!.lastActiveDay === today) return { day: today, alreadyCheckedIn: true, streak: { current: p!.streakCurrent, best: p!.streakBest }, restUsed: false, awarded: [] as Awarded[], pointsTotal: p!.pointsTotal }

    const gap = p!.lastActiveDay ? daysBetween(p!.lastActiveDay, today) : null
    let streak = 1, restUsed = false, lastRestOn = p!.lastRestOn
    if (gap === 1) streak = p!.streakCurrent + 1
    else if (gap === 2 && restAvailable(p!.lastRestOn, today)) { streak = p!.streakCurrent + 1; restUsed = true; lastRestOn = addDays(today, -1) }
    const best = Math.max(p!.streakBest, streak)

    await tx.insert(dailyCheckins).values({ userId, day: today }).onConflictDoNothing()
    await tx.update(userProgress).set({ streakCurrent: streak, streakBest: best, lastActiveDay: today, lastRestOn, updatedAt: new Date() }).where(eq(userProgress.userId, userId))

    const awarded: Awarded[] = []
    const a = await awardIn(tx, userId, 'checkin', `checkin:${today}`, today); if (a) awarded.push(a)
    for (const [days, kind] of STREAK_MILESTONES) if (streak >= days) { const m = await awardIn(tx, userId, kind, kind, today); if (m) awarded.push(m) }
    const [after] = await tx.select({ t: userProgress.pointsTotal }).from(userProgress).where(eq(userProgress.userId, userId)).limit(1)
    return { day: today, alreadyCheckedIn: false, streak: { current: streak, best }, restUsed, awarded, pointsTotal: after!.t }
  })
  // A friend's invite can come true on a check-in (their third day). Done outside the lock: it touches the inviter too.
  if (!out.alreadyCheckedIn) { const more = await qualifyInvite(userId, now); out.awarded.push(...more); out.pointsTotal += more.reduce((n, m) => n + m.points, 0) }
  return out
}

// ---- Friend invites -------------------------------------------------------------------------------------------------
/**
 * A friend counts when they have verified (always true), finished setting up, and opened the app on three different days.
 * Then both get points, once. The inviter's points stop at INVITES_PER_MONTH a month; the friend's bonus does not depend on that.
 * Returns what the invited friend earned.
 */
export async function qualifyInvite(inviteeId: string, now: Date = new Date()): Promise<Awarded[]> {
  const [u] = await db.select({ referredBy: users.referredBy, status: users.status }).from(users).where(eq(users.id, inviteeId)).limit(1)
  if (!u?.referredBy || u.status !== 'active') return []
  const [setUp] = await db.select({ userId: intentProfiles.userId }).from(intentProfiles).where(eq(intentProfiles.userId, inviteeId)).limit(1)
  if (!setUp) return []
  const [days] = await db.select({ n: count() }).from(dailyCheckins).where(eq(dailyCheckins.userId, inviteeId))
  if ((days?.n ?? 0) < INVITE_ACTIVE_DAYS) return []
  const mine = await award(inviteeId, 'invited_by_friend', 'invited', now)
  const [inviter] = await db.select({ status: users.status }).from(users).where(eq(users.id, u.referredBy)).limit(1)
  if (inviter?.status === 'active') await award(u.referredBy, 'invite_friend', `invite:${inviteeId}`, now)
  return mine ? [mine] : []
}

// ---- What the app shows ---------------------------------------------------------------------------------------------
export async function progressOf(userId: string, now: Date = new Date()) {
  const today = watDay(now), month = watMonth(now)
  const [p] = await db.select().from(userProgress).where(eq(userProgress.userId, userId)).limit(1)
  const [me] = await db.select({ inviteCode: users.inviteCode }).from(users).where(eq(users.id, userId)).limit(1)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const active = new Set((await db.select({ d: dailyCheckins.day }).from(dailyCheckins).where(and(eq(dailyCheckins.userId, userId), inArray(dailyCheckins.day, weekDays)))).map((r) => r.d))
  const recent = await db.select({ id: pointEvents.id, kind: pointEvents.kind, points: pointEvents.points, day: pointEvents.day }).from(pointEvents)
    .where(and(eq(pointEvents.userId, userId), isNull(pointEvents.reversedAt))).orderBy(desc(pointEvents.createdAt)).limit(12)
  const [invited] = await db.select({ n: count() }).from(users).where(eq(users.referredBy, userId))
  const [qualified] = await db.select({ n: count() }).from(pointEvents).where(and(eq(pointEvents.userId, userId), eq(pointEvents.kind, 'invite_friend'), isNull(pointEvents.reversedAt)))
  const [monthUsed] = await db.select({ n: count() }).from(pointEvents).where(and(eq(pointEvents.userId, userId), eq(pointEvents.kind, 'invite_friend'), isNull(pointEvents.reversedAt), gte(pointEvents.day, monthStart(month)), lt(pointEvents.day, nextMonthStart(month))))
  const streakAlive = p?.lastActiveDay && daysBetween(p.lastActiveDay, today) <= 2 // still reachable today (a rest day can cover one gap)
  return {
    today,
    points: p?.pointsTotal ?? 0,
    streak: { current: streakAlive ? p!.streakCurrent : 0, best: p?.streakBest ?? 0, checkedInToday: p?.lastActiveDay === today, restAvailable: restAvailable(p?.lastRestOn ?? null, today) },
    week: weekDays.map((d) => ({ day: d, active: active.has(d) })),
    recent: recent.map((r) => ({ id: r.id, label: RULES[r.kind as Kind]?.label ?? r.kind, points: r.points, day: r.day })),
    invite: { code: me!.inviteCode, url: `${env.webOrigin}/login?invite=${me!.inviteCode}`, invited: invited?.n ?? 0, rewarded: qualified?.n ?? 0, pending: Math.max(0, (invited?.n ?? 0) - (qualified?.n ?? 0)), monthUsed: monthUsed?.n ?? 0, monthMax: INVITES_PER_MONTH, activeDays: INVITE_ACTIVE_DAYS },
    rules: (Object.entries(RULES) as [Kind, (typeof RULES)[Kind]][]).map(([kind, r]) => ({ kind, points: r.points, how: r.how })),
  }
}

// ---- Staff: see and undo ----------------------------------------------------------------------------------------------
export async function ledgerOf(userId: string, limit = 25) {
  const rows = await db.select().from(pointEvents).where(eq(pointEvents.userId, userId)).orderBy(desc(pointEvents.createdAt)).limit(limit)
  return rows.map((r) => ({ id: r.id, kind: r.kind, label: RULES[r.kind as Kind]?.label ?? r.kind, points: r.points, day: r.day, createdAt: r.createdAt, reversed: !!r.reversedAt, reversalNote: r.reversalNote }))
}

/** Undo an award. The row stays (marked), its key stays used so it cannot be paid again, and the total drops by its points. */
export async function reversePoints(eventId: string, adminId: string, note: string) {
  return db.transaction(async (tx) => {
    const [ev] = await tx.select().from(pointEvents).where(eq(pointEvents.id, eventId)).limit(1)
    if (!ev) return { code: 404 as const }
    await lock(tx, ev.userId)
    const [done] = await tx.update(pointEvents).set({ reversedAt: new Date(), reversedBy: adminId, reversalNote: note })
      .where(and(eq(pointEvents.id, eventId), isNull(pointEvents.reversedAt))).returning()
    if (!done) return { code: 409 as const }
    await tx.update(userProgress).set({ pointsTotal: sql`${userProgress.pointsTotal} - ${done.points}`, updatedAt: new Date() }).where(eq(userProgress.userId, ev.userId))
    return { code: 200 as const, event: done }
  })
}
