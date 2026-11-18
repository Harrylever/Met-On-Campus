import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { pointEvents, userProgress, users } from '@moc/db'
import { db } from '../src/context'
import { award } from '../src/rewards/engine'
import { firstNameOf, leaderboardOf } from '../src/rewards/leaderboard'
import { watDay, weekStart } from '../src/rewards/time'
import { adminCall, adminLogin, call, makeAdmin, makeUser, resetAll } from './helpers'

beforeEach(resetAll)
type U = { id: string; token: string }
const at = (day: string) => new Date(`${day}T12:00:00Z`)
// A person with exactly `n` points on `day` (today by default, which is always in the current week the routes rank).
async function pts(u: U, n: number, day = watDay()) {
  await award(u.id, 'streak_3', `t:${Math.random()}`, at(day))   // each pays 10
  for (let i = 1; i < n / 10; i++) await award(u.id, 'streak_3', `t:${Math.random()}`, at(day))
}
const join = (u: U, on = true) => call(u, 'PUT', '/me/leaderboard', { optIn: on })

describe('weeks', () => {
  test('a Nigerian week runs Monday to Sunday', () => {
    expect(weekStart('2026-03-09')).toBe('2026-03-09') // Monday
    expect(weekStart('2026-03-11')).toBe('2026-03-09') // Wednesday
    expect(weekStart('2026-03-15')).toBe('2026-03-09') // Sunday
    expect(weekStart('2026-03-16')).toBe('2026-03-16') // next Monday
    expect(weekStart('2026-03-01')).toBe('2026-02-23') // crosses a month
  })
})

describe('names', () => {
  test('first name only; anything that could be a matric number becomes "A student"', () => {
    expect(firstNameOf('Amina Bello')).toBe('Amina')
    expect(firstNameOf('  Tunde  ')).toBe('Tunde')
    expect(firstNameOf('2200765')).toBe('A student')
    expect(firstNameOf('M2200765 Dean')).toBe('A student')
    expect(firstNameOf('')).toBe('A student')
    expect(firstNameOf('Averyveryverylongnamethatisnotaname')).toBe('A student')
  })
})

describe('opt-in', () => {
  test('needs sign-in; off by default and shows nothing about anyone else until you join', async () => {
    expect((await call(null, 'GET', '/me/leaderboard')).status).toBe(401)
    expect((await call(null, 'PUT', '/me/leaderboard', { optIn: true })).status).toBe(401)
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await join(b); await pts(b, 50)
    const seen = (await call(a, 'GET', '/me/leaderboard')).json
    expect(seen.optedIn).toBe(false)
    expect(seen.entries).toBeUndefined(); expect(seen.me).toBeUndefined()
    expect(JSON.stringify(seen)).not.toMatch(/Tunde/)
  })

  test('joining puts you on the board; leaving takes you off at once; joining needs a boolean', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await join(a); await join(b); await pts(a, 30); await pts(b, 20)
    expect((await call(a, 'GET', '/me/leaderboard')).json.entries.map((e: any) => e.name)).toEqual(['Amina', 'Tunde'])
    const left = (await join(b, false)).json
    expect(left.optedIn).toBe(false)
    expect((await call(a, 'GET', '/me/leaderboard')).json.entries.map((e: any) => e.name)).toEqual(['Amina'])
    expect((await call(a, 'PUT', '/me/leaderboard', { optIn: 'yes' })).status).toBe(422)
    expect((await join(a)).status).toBe(200)                                                        // joining twice is harmless
    expect((await db.select().from(userProgress).where(eq(userProgress.userId, b.id)))[0]!.leaderboardOptIn).toBe(false)
  })
})

describe('what the board shows', () => {
  test('a first name, a level and points, ranked, and nothing that identifies anyone further', async () => {
    const a = await makeUser('Amina', { level: 200 }) as U, b = await makeUser('Tunde', { level: 400 }) as U, c = await makeUser('Ngozi', { level: 100 }) as U
    for (const u of [a, b, c]) await join(u)
    await pts(a, 30); await pts(b, 50); await pts(c, 10)
    const r = (await call(a, 'GET', '/me/leaderboard')).json
    expect(r.entries).toEqual([
      { rank: 1, name: 'Tunde', level: 400, points: 50, you: false },
      { rank: 2, name: 'Amina', level: 200, points: 30, you: true },
      { rank: 3, name: 'Ngozi', level: 100, points: 10, you: false },
    ])
    expect(r.me).toEqual({ rank: 2, points: 30 })
    for (const e of r.entries) expect(Object.keys(e).sort()).toEqual(['level', 'name', 'points', 'rank', 'you'])
    const flat = JSON.stringify(r)
    expect(flat).not.toMatch(/@|department|Computer Science|photo|email/i)
    expect(flat).not.toContain(b.id)                                                                  // nobody else's id leaves the server
  })

  test('only this university, and only people who joined', async () => {
    const a = await makeUser('Amina') as U, same = await makeUser('Tunde') as U, hidden = await makeUser('Ngozi') as U, other = await makeUser('Chidi', { university: 'unilag' }) as U
    for (const u of [a, same, other]) await join(u)
    for (const u of [a, same, hidden, other]) await pts(u, 20)
    const names = (await call(a, 'GET', '/me/leaderboard')).json.entries.map((e: any) => e.name).sort()
    expect(names).toEqual(['Amina', 'Tunde'])                                                         // not Ngozi (never joined), not Chidi (other campus)
    expect((await call(other, 'GET', '/me/leaderboard')).json.entries.map((e: any) => e.name)).toEqual(['Chidi'])
  })

  test('suspended students and zero-point students are not listed', async () => {
    const a = await makeUser('Amina') as U, sus = await makeUser('Tunde') as U, zero = await makeUser('Ngozi') as U
    for (const u of [a, sus, zero]) await join(u)
    await pts(a, 20); await pts(sus, 90)
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, sus.id))
    const r = (await call(a, 'GET', '/me/leaderboard')).json
    expect(r.entries.map((e: any) => e.name)).toEqual(['Amina'])
    expect(r.joined).toBe(2)                                                                          // Amina and Ngozi are still joined
    expect((await call(zero, 'GET', '/me/leaderboard')).json).toMatchObject({ optedIn: true, me: null, ranked: 1 })
  })

  test('a matric-number name shows as "A student"', async () => {
    const a = await makeUser('Amina') as U, m = await makeUser('M2200765') as U
    await join(a); await join(m); await pts(a, 10); await pts(m, 20)
    expect((await call(a, 'GET', '/me/leaderboard')).json.entries[0]).toMatchObject({ name: 'A student', points: 20 })
  })
})

describe('the week', () => {
  test('counts this Nigerian week only, and resets on Monday', async () => {
    const a = await makeUser('Amina') as U
    await join(a)
    await award(a.id, 'onboarding', 'ob', at('2026-03-08'))                                           // Sunday: last week
    await award(a.id, 'profile_complete', 'pc', at('2026-03-09'))                                     // Monday: this week
    await award(a.id, 'photo_approved', 'ph', at('2026-03-15'))                                       // Sunday: still this week
    const during = await leaderboardOf(a.id, at('2026-03-15'))
    expect(during).toMatchObject({ weekStart: '2026-03-09', weekEnd: '2026-03-15', resetsInDays: 1, me: { rank: 1, points: 35 } })
    const after = await leaderboardOf(a.id, at('2026-03-16'))                                         // Monday: a fresh week
    expect(after).toMatchObject({ weekStart: '2026-03-16', resetsInDays: 7, me: null, ranked: 0 })
    expect((await leaderboardOf(a.id, at('2026-03-08'))).me!.points).toBe(20)                         // and last week's board was its own
  })

  test('the week follows Nigerian time, not UTC', async () => {
    const a = await makeUser('Amina') as U
    await join(a)
    await award(a.id, 'onboarding', 'ob', new Date('2026-03-15T23:30:00Z'))                           // 00:30 Monday in Nigeria
    expect((await leaderboardOf(a.id, new Date('2026-03-15T22:00:00Z'))).me).toBeNull()               // 23:00 Sunday there: not yet
    expect((await leaderboardOf(a.id, new Date('2026-03-15T23:45:00Z'))).me).toMatchObject({ points: 20 })
  })

  test('a staff reversal moves the board at once', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await join(a); await join(b); await pts(a, 20); await pts(b, 30)
    const ev = (await db.select().from(pointEvents).where(eq(pointEvents.userId, b.id)))[0]!
    const S = await adminLogin(await makeAdmin())
    expect((await adminCall('POST', `/admin/points/${ev.id}/reverse`, { note: 'Fake account farming' }, { session: S })).status).toBe(200)
    const r = (await call(a, 'GET', '/me/leaderboard')).json
    expect(r.entries.map((e: any) => [e.name, e.points])).toEqual([['Amina', 20], ['Tunde', 20]])   // Tunde had 30, one 10 reversed
  })
})

describe('ranking', () => {
  test('a tie goes to whoever got there first, and ranks are never shared', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await join(a); await join(b)
    await award(b.id, 'onboarding', 'x', at('2026-03-10')); await Bun.sleep(20); await award(a.id, 'onboarding', 'y', at('2026-03-10'))
    const r = await leaderboardOf(a.id, at('2026-03-11'))
    expect(r.entries!.map((e) => [e.rank, e.name, e.points])).toEqual([[1, 'Tunde', 20], [2, 'Amina', 20]])
  })

  test('shows the top 10, and your own place when you are further down', async () => {
    const people: U[] = []
    for (let i = 0; i < 13; i++) { const u = await makeUser(`P${String.fromCharCode(97 + i)}`) as U; await join(u); people.push(u); await pts(u, (13 - i) * 10) } // Pa leads
    const top = (await call(people[0]!, 'GET', '/me/leaderboard')).json
    expect(top.entries).toHaveLength(10); expect(top.ranked).toBe(13); expect(top.entries[0]).toMatchObject({ rank: 1, you: true })
    const low = (await call(people[12]!, 'GET', '/me/leaderboard')).json
    expect(low.entries).toHaveLength(11)
    expect(low.entries[10]).toMatchObject({ rank: 13, you: true, points: 10 }); expect(low.me).toEqual({ rank: 13, points: 10 })
    expect(low.entries.slice(0, 10).every((e: any) => !e.you)).toBe(true)
  })

  test('Romance activity cannot move anyone: it never earns points in the first place', async () => {
    const a = await makeUser('Amina', { modes: ['romance'] }) as U, b = await makeUser('Tunde', { modes: ['romance'] }) as U
    await join(a)
    const inv = (await call(a, 'POST', '/connections', { toUserId: b.id, intent: 'romance' })).json
    await call(b, 'PATCH', `/connections/${inv.requestId}`, { status: 'accepted' })
    expect((await call(a, 'GET', '/me/leaderboard')).json).toMatchObject({ me: null, ranked: 0 })
  })
})

describe('staff and deletion', () => {
  test('staff can see whether a student is on the board', async () => {
    const a = await makeUser('Amina') as U
    const S = await adminLogin(await makeAdmin())
    expect((await adminCall('GET', `/admin/users/${a.id}`, undefined, { session: S })).json.rewards.onLeaderboard).toBe(false)
    await join(a)
    expect((await adminCall('GET', `/admin/users/${a.id}`, undefined, { session: S })).json.rewards.onLeaderboard).toBe(true)
  })

  test('deleting an account removes the person from the board', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await join(a); await join(b); await pts(a, 20); await pts(b, 30)
    await db.delete(users).where(eq(users.id, b.id))
    expect((await call(a, 'GET', '/me/leaderboard')).json.entries.map((e: any) => e.name)).toEqual(['Amina'])
  })
})
