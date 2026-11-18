import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { dailyCheckins, pointEvents, userBadges, userProgress, users } from '@moc/db'
import { db } from '../src/context'
import { deleteAccount } from '../src/account'
import { syncBadges } from '../src/rewards/badges'
import { award, checkIn } from '../src/rewards/engine'
import { watDay } from '../src/rewards/time'
import { adminCall, adminLogin, call, makeAdmin, makeUser, resetAll } from './helpers'

beforeEach(resetAll)
type U = { id: string; token: string }
const day = (n: number) => new Date(Date.UTC(2026, 2, 1 + n, 12))
const names = async (u: U) => (await call(u, 'GET', '/me/leaderboard')).json.entries.map((e: any) => e.name) as string[]
async function onBoard(u: U, points = 20) {
  await call(u, 'PUT', '/me/leaderboard', { optIn: true })
  for (let i = 0; i < points / 10; i++) await award(u.id, 'streak_3', `t:${Math.random()}`, new Date())
}
/** `friend` joins through `inviter`'s link, sets up (makeUser gives a Study profile) and opens the app on 3 days. */
async function invite(inviter: U, friend: U, days = 3) {
  await db.update(users).set({ referredBy: inviter.id }).where(eq(users.id, friend.id))
  for (let i = 0; i < days; i++) await checkIn(friend.id, day(i))
}

describe('blocking and the leaderboard', () => {
  test('people who blocked each other never see one another, whoever did the blocking; others see both', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U, c = await makeUser('Ngozi') as U
    for (const u of [a, b, c]) await onBoard(u)
    expect((await names(a)).sort()).toEqual(['Amina', 'Ngozi', 'Tunde'])
    expect((await call(a, 'POST', '/blocks', { userId: b.id })).status).toBeLessThan(300)
    expect((await names(a)).sort()).toEqual(['Amina', 'Ngozi'])                                     // the blocker no longer sees Tunde
    expect((await names(b)).sort()).toEqual(['Ngozi', 'Tunde'])                                     // and the blocked person no longer sees Amina
    expect((await names(c)).sort()).toEqual(['Amina', 'Ngozi', 'Tunde'])                            // everyone else is unaffected
    await call(a, 'DELETE', `/blocks/${b.id}`)
    expect((await names(a)).sort()).toEqual(['Amina', 'Ngozi', 'Tunde'])                            // unblocking brings them back
  })

  test('your own place is still shown, and ranks count only the people you can see', async () => {
    const top = await makeUser('Amina') as U, mid = await makeUser('Tunde') as U, me = await makeUser('Ngozi') as U
    await onBoard(top, 90); await onBoard(mid, 50); await onBoard(me, 20)
    expect((await call(me, 'GET', '/me/leaderboard')).json.me).toEqual({ rank: 3, points: 20 })
    await call(me, 'POST', '/blocks', { userId: top.id })
    expect((await call(me, 'GET', '/me/leaderboard')).json.me).toEqual({ rank: 2, points: 20 })    // the person they cannot see is not counted above them
  })
})

describe('deleting an account', () => {
  test('removes every reward record, drops them from the board, and leaves other people their points', async () => {
    const inviter = await makeUser('Amina') as U, me = await makeUser('Tunde') as U, friend = await makeUser('Ngozi') as U, watcher = await makeUser('Chidi') as U
    await db.update(users).set({ referredBy: inviter.id }).where(eq(users.id, me.id))
    for (let i = 0; i < 3; i++) await checkIn(me.id, day(i))                                       // pays Tunde, and Amina for inviting him
    await invite(me, friend)                                                                       // Tunde invited Ngozi, who paid Tunde
    await syncBadges(me.id); await onBoard(me, 20); await onBoard(watcher)
    const inviterBefore = (await db.select().from(userProgress).where(eq(userProgress.userId, inviter.id)))[0]!.pointsTotal
    expect(inviterBefore).toBeGreaterThanOrEqual(30)
    expect((await names(watcher))).toContain('Tunde')

    expect(await deleteAccount(me.id, { kind: 'self' })).toBe(true)

    for (const t of [userProgress, pointEvents, dailyCheckins, userBadges]) expect(await db.select().from(t).where(eq(t.userId, me.id))).toHaveLength(0)
    expect(await names(watcher)).not.toContain('Tunde')
    expect((await db.select().from(userProgress).where(eq(userProgress.userId, inviter.id)))[0]!.pointsTotal).toBe(inviterBefore)   // Amina keeps what she earned
    const f = (await db.select().from(users).where(eq(users.id, friend.id)))[0]!
    expect(f.referredBy).toBeNull()                                                                // Ngozi stays, with the link back cleared
    expect((await db.select().from(userProgress).where(eq(userProgress.userId, friend.id)))[0]!.pointsTotal).toBeGreaterThan(0)
  })

  test('a friend who deletes before qualifying never pays the inviter', async () => {
    const inviter = await makeUser('Amina') as U, friend = await makeUser('Ngozi') as U
    await db.update(users).set({ referredBy: inviter.id }).where(eq(users.id, friend.id))
    await checkIn(friend.id, day(0)); await checkIn(friend.id, day(1))
    await deleteAccount(friend.id, { kind: 'self' })
    expect((await db.select().from(pointEvents).where(eq(pointEvents.userId, inviter.id))).filter((e) => e.kind === 'invite_friend')).toHaveLength(0)
  })

  test('what Amina earned for inviting stays labelled generically: it never names the friend', async () => {
    const inviter = await makeUser('Amina') as U, friend = await makeUser('Tunde') as U
    await invite(inviter, friend)
    await deleteAccount(friend.id, { kind: 'self' })
    const p = (await call(inviter, 'GET', '/me/progress')).json
    expect(p.recent.some((e: any) => e.label === 'A friend you invited joined')).toBe(true)
    expect(JSON.stringify(p)).not.toMatch(/Tunde|@/)
  })
})

describe('staff: who a student invited', () => {
  test('lists each friend with join date, active days and whether they paid out; no emails', async () => {
    const inviter = await makeUser('Amina') as U, paid = await makeUser('Tunde') as U, waiting = await makeUser('Ngozi') as U
    await invite(inviter, paid, 3); await invite(inviter, waiting, 1)
    const S = await adminLogin(await makeAdmin())
    const r = (await adminCall('GET', `/admin/users/${inviter.id}`, undefined, { session: S })).json.rewards
    expect(r.invited).toBe(2)
    const by = Object.fromEntries(r.invitees.map((i: any) => [i.name, i]))
    expect(by.Tunde).toMatchObject({ activeDays: 3, paid: true }); expect(by.Ngozi).toMatchObject({ activeDays: 1, paid: false })
    expect(JSON.stringify(r.invitees)).not.toMatch(/@/)
    // reversing the payout shows as not paid
    const ev = (await db.select().from(pointEvents).where(eq(pointEvents.userId, inviter.id))).find((e) => e.kind === 'invite_friend')!
    await adminCall('POST', `/admin/points/${ev.id}/reverse`, { note: 'Fake accounts' }, { session: S })
    const after = (await adminCall('GET', `/admin/users/${inviter.id}`, undefined, { session: S })).json.rewards.invitees
    expect(after.find((i: any) => i.name === 'Tunde').paid).toBe(false)
  })

  test('a student with no invitees has an empty list', async () => {
    const a = await makeUser('Amina') as U
    const S = await adminLogin(await makeAdmin())
    expect((await adminCall('GET', `/admin/users/${a.id}`, undefined, { session: S })).json.rewards.invitees).toEqual([])
  })
})
