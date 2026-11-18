import { and, eq, isNull, sql } from 'drizzle-orm'
import { userBadges } from '@moc/db'
import { bus, db, topics } from '../context'

// Badges recognise things a student has really done. They pay no points (that would count the same effort twice) and nothing
// in Romance can earn one. Every rule is a plain test over "facts" read from the real data, so a student who already did
// something before badges existed gets the badge the next time the app opens, with no special backfill.

export type BadgeId =
  | 'welcome' | 'face_of_campus'
  | 'connector' | 'study_buddy' | 'friend_maker' | 'social_circle'
  | 'study_room' | 'hangout' | 'host' | 'meetup'
  | 'streak_3' | 'streak_7' | 'streak_30'
  | 'first_invite' | 'crew_builder' | 'community_builder'

export type Facts = {
  setup: boolean; photo: boolean
  connections: number; studyConnection: boolean; friendsConnection: boolean
  studyRoom: boolean; hangout: boolean; hosted: boolean; meetup: boolean
  streakBest: number; invites: number
}

export type Badge = { id: BadgeId; name: string; how: string; group: 'start' | 'connect' | 'rooms' | 'streak' | 'invite'; test: (f: Facts) => boolean }

export const BADGES: Badge[] = [
  { id: 'welcome',           group: 'start',   name: 'Welcome',              how: 'Finish setting up your account.',                              test: (f) => f.setup },
  { id: 'face_of_campus',    group: 'start',   name: 'Face of campus',       how: 'Get your first Study or Friends photo approved.',              test: (f) => f.photo },
  { id: 'connector',         group: 'connect', name: 'Connector',            how: 'Make your first connection.',                                  test: (f) => f.connections >= 1 },
  { id: 'study_buddy',       group: 'connect', name: 'Study buddy',          how: 'Connect with someone in Study.',                               test: (f) => f.studyConnection },
  { id: 'friend_maker',      group: 'connect', name: 'Friend maker',         how: 'Connect with someone in Friends.',                             test: (f) => f.friendsConnection },
  { id: 'social_circle',     group: 'connect', name: 'Social circle',        how: 'Make 5 connections.',                                          test: (f) => f.connections >= 5 },
  { id: 'study_room',        group: 'rooms',   name: 'First study room',     how: 'Join a study room.',                                           test: (f) => f.studyRoom },
  { id: 'hangout',           group: 'rooms',   name: 'First hangout',        how: 'Join a hangout.',                                              test: (f) => f.hangout },
  { id: 'host',              group: 'rooms',   name: 'Host',                 how: 'Host a room that gets at least 2 other people.',               test: (f) => f.hosted },
  { id: 'meetup',            group: 'rooms',   name: 'Meetup planner',       how: 'Agree a meetup in a Study or Friends chat.',                   test: (f) => f.meetup },
  { id: 'streak_3',          group: 'streak',  name: '3-day streak',         how: 'Open the app 3 days in a row.',                                test: (f) => f.streakBest >= 3 },
  { id: 'streak_7',          group: 'streak',  name: 'Week streak',          how: 'Open the app 7 days in a row.',                                test: (f) => f.streakBest >= 7 },
  { id: 'streak_30',         group: 'streak',  name: 'Month streak',         how: 'Open the app 30 days in a row.',                               test: (f) => f.streakBest >= 30 },
  { id: 'first_invite',      group: 'invite',  name: 'Bring a friend',       how: 'A friend you invited joins and settles in.',                   test: (f) => f.invites >= 1 },
  { id: 'crew_builder',      group: 'invite',  name: 'Crew builder',         how: 'Bring 3 friends.',                                             test: (f) => f.invites >= 3 },
  { id: 'community_builder', group: 'invite',  name: 'Community builder',    how: 'Bring 10 friends.',                                            test: (f) => f.invites >= 10 },
]
export const BADGE_BY_ID = new Map(BADGES.map((b) => [b.id, b]))

/** Everything a rule needs, from the real tables, in one query. Romance never counts toward any of it. */
export async function factsOf(userId: string): Promise<Facts> {
  const [r] = await db.execute(sql`
    select
      exists (select 1 from intent_profiles where user_id = ${userId} and enabled) as setup,
      exists (select 1 from profile_photos where user_id = ${userId} and intent <> 'romance' and reviewed_at is not null and status in ('approved', 'replaced', 'removed')) as photo,
      (select count(*)::int from connection_requests where status = 'accepted' and intent <> 'romance' and (from_user_id = ${userId} or to_user_id = ${userId})) as connections,
      exists (select 1 from connection_requests where status = 'accepted' and intent = 'study' and (from_user_id = ${userId} or to_user_id = ${userId})) as study_connection,
      exists (select 1 from connection_requests where status = 'accepted' and intent = 'friends' and (from_user_id = ${userId} or to_user_id = ${userId})) as friends_connection,
      exists (select 1 from room_members m join rooms r on r.id = m.room_id where m.user_id = ${userId} and m.status = 'approved' and r.host_id <> ${userId} and r.intent = 'study') as study_room,
      exists (select 1 from room_members m join rooms r on r.id = m.room_id where m.user_id = ${userId} and m.status = 'approved' and r.host_id <> ${userId} and r.intent = 'friends') as hangout,
      exists (select 1 from rooms r where r.host_id = ${userId} and (select count(*) from room_members m where m.room_id = r.id and m.status = 'approved' and m.user_id <> ${userId}) >= 2) as hosted,
      exists (select 1 from messages m join conversations c on c.id = m.conversation_id where m.kind = 'meetup' and m.meetup_status = 'confirmed' and c.intent <> 'romance' and (c.user_a_id = ${userId} or c.user_b_id = ${userId})) as meetup,
      coalesce((select streak_best from user_progress where user_id = ${userId}), 0) as streak_best,
      (select count(*)::int from point_events where user_id = ${userId} and kind = 'invite_friend' and reversed_at is null) as invites`)
  const x = r as Record<string, any>
  return {
    setup: !!x.setup, photo: !!x.photo, connections: Number(x.connections), studyConnection: !!x.study_connection, friendsConnection: !!x.friends_connection,
    studyRoom: !!x.study_room, hangout: !!x.hangout, hosted: !!x.hosted, meetup: !!x.meetup, streakBest: Number(x.streak_best), invites: Number(x.invites),
  }
}

/**
 * Grants every badge this student has earned and does not yet have. Idempotent and safe to call as often as you like: a
 * badge already held (or revoked by staff) is never touched. Returns the ones just earned, and tells the student.
 */
export async function syncBadges(userId: string): Promise<BadgeId[]> {
  const f = await factsOf(userId)
  const have = new Set((await db.select({ b: userBadges.badge }).from(userBadges).where(eq(userBadges.userId, userId))).map((r) => r.b))
  const due = BADGES.filter((b) => !have.has(b.id) && b.test(f))
  if (due.length === 0) return []
  const inserted = await db.insert(userBadges).values(due.map((b) => ({ userId, badge: b.id }))).onConflictDoNothing().returning({ badge: userBadges.badge })
  for (const r of inserted) bus.publish(topics.user(userId), { type: 'badge.earned', badge: r.badge })
  return inserted.map((r) => r.badge as BadgeId)
}

/** The whole shelf: every badge, with when it was earned (null if not yet) and whether it is new to the student. */
export async function shelfOf(userId: string) {
  const rows = await db.select().from(userBadges).where(and(eq(userBadges.userId, userId), isNull(userBadges.revokedAt)))
  const mine = new Map(rows.map((r) => [r.badge, r]))
  const badges = BADGES.map((b) => { const r = mine.get(b.id); return { id: b.id, name: b.name, how: b.how, group: b.group, earnedAt: r?.earnedAt ?? null, isNew: !!r && !r.seenAt } })
  return { badges, earned: rows.length, total: BADGES.length }
}

/** Badges earned but not yet looked at, for the "you earned a badge" notice. */
export async function newBadgesOf(userId: string) {
  const rows = await db.select({ badge: userBadges.badge }).from(userBadges).where(and(eq(userBadges.userId, userId), isNull(userBadges.revokedAt), isNull(userBadges.seenAt)))
  return rows.map((r) => ({ id: r.badge, name: BADGE_BY_ID.get(r.badge as BadgeId)?.name ?? r.badge }))
}

export async function markBadgesSeen(userId: string) {
  await db.update(userBadges).set({ seenAt: new Date() }).where(and(eq(userBadges.userId, userId), isNull(userBadges.seenAt)))
}

/** Staff: take a badge back (for example one earned through abuse). The row stays so it can never be re-granted. */
export async function revokeBadge(userId: string, badge: string, adminId: string, note: string) {
  const [row] = await db.update(userBadges).set({ revokedAt: new Date(), revokedBy: adminId, revokedNote: note })
    .where(and(eq(userBadges.userId, userId), eq(userBadges.badge, badge), isNull(userBadges.revokedAt))).returning()
  return row ?? null
}

export async function badgesForStaff(userId: string) {
  const rows = await db.select().from(userBadges).where(eq(userBadges.userId, userId))
  return rows.map((r) => ({ id: r.badge, name: BADGE_BY_ID.get(r.badge as BadgeId)?.name ?? r.badge, earnedAt: r.earnedAt, revoked: !!r.revokedAt, revokedNote: r.revokedNote }))
}
