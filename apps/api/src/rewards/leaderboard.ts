import { eq, sql } from 'drizzle-orm'
import { userProgress, users } from '@moc/db'
import { db } from '../context'
import { addDays, daysBetween, watDay, weekStart } from './time'

// The weekly campus leaderboard. Opt-in and off by default: only students who turned it on appear, and only they can see it, so
// nobody can look at the board without being on it. It shows a first name and a level and nothing else (no photo, department
// or link to a profile), only people at the same university, and only points from this Nigerian week (Monday to Sunday). The
// ranking is read straight from the points ledger, so there is nothing to reset and a staff reversal counts at once.
// Romance never earns points, so it can never move anyone on this board.

export const BOARD_SIZE = 10

/** What other students see of a person: their first name, or "A student" when the name looks like a matric number. */
export const firstNameOf = (name: string) => {
  const first = name.trim().split(/\s+/)[0] ?? ''
  return first && first.length <= 20 && !/\d/.test(first) ? first : 'A student'
}

export async function setLeaderboard(userId: string, optIn: boolean) {
  await db.insert(userProgress).values({ userId, leaderboardOptIn: optIn, leaderboardAt: optIn ? new Date() : null })
    .onConflictDoUpdate({ target: userProgress.userId, set: optIn ? { leaderboardOptIn: true, leaderboardAt: new Date() } : { leaderboardOptIn: false } })
}

export async function leaderboardOf(userId: string, now: Date = new Date()) {
  const [me] = await db.select({ university: users.university, optIn: userProgress.leaderboardOptIn })
    .from(users).leftJoin(userProgress, eq(userProgress.userId, users.id)).where(eq(users.id, userId)).limit(1)
  const today = watDay(now), start = weekStart(today), next = addDays(start, 7)
  const base = { campus: me?.university ?? '', weekStart: start, weekEnd: addDays(start, 6), resetsInDays: daysBetween(today, next) }
  if (!me?.optIn) return { optedIn: false as const, ...base }

  const rows = (await db.execute(sql`
    with board as (
      select u.id, u.name, u.level, sum(e.points)::int as pts,
             row_number() over (order by sum(e.points) desc, max(e.created_at) asc, u.id asc)::int as rank
      from user_progress p
      join users u on u.id = p.user_id
      join point_events e on e.user_id = u.id and e.reversed_at is null and e.day >= ${start} and e.day < ${next}
      where p.leaderboard_opt_in and u.university = ${me.university} and u.status = 'active'
      group by u.id, u.name, u.level
      having sum(e.points) > 0)
    select id, name, level, pts, rank, (select count(*)::int from board) as total from board
    where rank <= ${BOARD_SIZE} or id = ${userId} order by rank`)) as unknown as { id: string; name: string; level: number; pts: number; rank: number; total: number }[]

  const [{ n: joined } = { n: 0 }] = (await db.execute(sql`
    select count(*)::int as n from user_progress p join users u on u.id = p.user_id
    where p.leaderboard_opt_in and u.university = ${me.university} and u.status = 'active'`)) as unknown as { n: number }[]
  const mine = rows.find((r) => r.id === userId)
  return {
    optedIn: true as const, ...base, joined, ranked: rows[0]?.total ?? 0,
    me: mine ? { rank: mine.rank, points: mine.pts } : null, // null: no points yet this week
    entries: rows.map((r) => ({ rank: r.rank, name: firstNameOf(r.name), level: r.level, points: r.pts, you: r.id === userId })),
  }
}
