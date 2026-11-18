import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { adminAudit, connectionRequests, conversations, intentProfiles, messages, profilePhotos, userBadges, users } from '@moc/db'
import { bus, db } from '../src/context'
import { BADGES, syncBadges } from '../src/rewards/badges'
import { award, checkIn } from '../src/rewards/engine'
import { noticeFor } from '../src/push'
import { orderedPair } from '../src/visibility'
import { adminCall, adminLogin, call, makeAdmin, makeUser, resetAll } from './helpers'

beforeEach(resetAll)
type U = { id: string; token: string; email: string }
const mine = async (id: string) => (await db.select().from(userBadges).where(eq(userBadges.userId, id))).filter((b) => !b.revokedAt).map((b) => b.badge).sort()
const future = () => new Date(Date.now() + 3_600_000).toISOString()
const at = (day: string) => new Date(`${day}T12:00:00Z`)
async function connect(a: U, b: U, intent: 'study' | 'friends' | 'romance' = 'study') {
  const inv = (await call(a, 'POST', '/connections', { toUserId: b.id, intent })).json
  await call(b, 'PATCH', `/connections/${inv.requestId}`, { status: 'accepted' })
  return inv as { requestId: string; conversationId: string }
}

describe('the catalogue', () => {
  test('16 badges with unique ids and a way to earn each', () => {
    expect(BADGES).toHaveLength(16)
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(16)
    for (const b of BADGES) { expect(b.name.length).toBeGreaterThan(2); expect(b.how.endsWith('.')).toBe(true) }
  })
})

describe('what earns a badge', () => {
  test('nothing at the start, then Welcome once an account is set up', async () => {
    const u = await makeUser('Amina', { modes: [] }) as U
    expect(await syncBadges(u.id)).toEqual([])
    await call(u, 'PUT', '/me/profiles/study', { enabled: true })
    expect(await mine(u.id)).toEqual(['welcome'])
  })

  test('connections: Connector and Study buddy for a Study connection, Friend maker for Friends, Social circle at five', async () => {
    const a = await makeUser('Amina', { modes: ['study', 'friends'] }) as U
    const pals = [] as U[]
    for (let i = 0; i < 5; i++) pals.push(await makeUser(`Pal${i}`, { modes: ['study', 'friends'] }) as U)
    await connect(a, pals[0]!, 'study')
    expect(await mine(a.id)).toEqual(['connector', 'study_buddy', 'welcome'])
    expect(await mine(pals[0]!.id)).toEqual(['connector', 'study_buddy', 'welcome'])            // both sides
    await connect(a, pals[1]!, 'friends')
    expect(await mine(a.id)).toContain('friend_maker')
    for (const p of pals.slice(2, 4)) await connect(a, p, 'study')                              // four connections so far
    await syncBadges(a.id); expect(await mine(a.id)).not.toContain('social_circle')
    await connect(a, pals[4]!, 'study')
    expect(await mine(a.id)).toContain('social_circle')                                         // five in total
    expect(await mine(pals[2]!.id)).not.toContain('social_circle')
  })

  test('Romance never earns a badge: not connections, not meetups, not photos', async () => {
    const a = await makeUser('Amina', { modes: ['romance'], department: 'Cyber Security' }) as U, b = await makeUser('Tunde', { modes: ['romance'], department: 'Computer Science' }) as U
    const c = await connect(a, b, 'romance')
    const m = (await call(a, 'POST', `/conversations/${c.conversationId}/messages`, { kind: 'meetup', where: 'University Library', when: future() })).json.message
    await call(b, 'PATCH', `/messages/${m.id}/meetup`, { status: 'confirmed' })
    const [p] = await db.insert(profilePhotos).values({ userId: a.id, intent: 'romance', storageKey: 'photos/x.webp', status: 'pending' }).returning()
    const S = await adminLogin(await makeAdmin()); await adminCall('POST', '/admin/photos/resolve', { photoId: p!.id, action: 'approve' }, { session: S })
    for (const u of [a, b]) { await syncBadges(u.id); expect(await mine(u.id)).toEqual(['welcome']) }  // only "set up": the account exists, nothing in Romance counted
  })

  test('rooms: First study room, First hangout, and Host only when two others are in', async () => {
    const host = await makeUser('Host', { modes: ['study', 'friends'] }) as U, g1 = await makeUser('G1', { modes: ['study', 'friends'] }) as U, g2 = await makeUser('G2', { modes: ['study', 'friends'] }) as U
    const make = async (intent: 'study' | 'friends') => (await call(host, 'POST', '/rooms', { intent, tag: 'X', title: 'T', place: 'University Library', startsAt: new Date().toISOString(), endsAt: future(), capacity: 5 })).json.room.id as string
    const study = await make('study'), hang = await make('friends')
    const join = async (u: U, room: string) => { await call(u, 'POST', `/rooms/${room}/request`); await call(host, 'POST', `/rooms/${room}/requests/${u.id}`, { decision: 'approved' }) }
    await join(g1, study)
    await syncBadges(host.id)                                                                    // re-checked with one guest in: still not a full room
    expect(await mine(g1.id)).toContain('study_room'); expect(await mine(g1.id)).not.toContain('hangout'); expect(await mine(host.id)).not.toContain('host')
    await join(g1, hang)
    expect(await mine(g1.id)).toContain('hangout')
    await join(g2, study)
    expect(await mine(host.id)).toContain('host')                                               // two others in the study room
    expect(await mine(host.id)).not.toContain('study_room')                                     // hosting is not joining
  })

  test('Meetup planner for both people when it is agreed, not when declined', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    const c = await connect(a, b)
    const send = async (where: string) => (await call(a, 'POST', `/conversations/${c.conversationId}/messages`, { kind: 'meetup', where, when: future() })).json.message.id as string
    await call(b, 'PATCH', `/messages/${await send('University Library')}/meetup`, { status: 'declined' })
    await syncBadges(a.id); await syncBadges(b.id)
    expect(await mine(a.id)).not.toContain('meetup'); expect(await mine(b.id)).not.toContain('meetup')
    await call(b, 'PATCH', `/messages/${await send('ICT Centre')}/meetup`, { status: 'confirmed' })
    for (const u of [a, b]) expect(await mine(u.id)).toContain('meetup')
  })

  test('streak badges at 3, 7 and 30 days, and they stay after the streak is lost', async () => {
    const u = await makeUser('Amina') as U
    const day = (n: number) => at(new Date(Date.UTC(2026, 2, 1 + n)).toISOString().slice(0, 10))
    for (let i = 0; i < 2; i++) await checkIn(u.id, day(i))
    expect((await mine(u.id)).filter((b) => b.startsWith('streak'))).toEqual([])                  // two days: not yet
    await checkIn(u.id, day(2))
    expect((await mine(u.id)).filter((b) => b.startsWith('streak'))).toEqual(['streak_3'])
    for (let i = 3; i < 7; i++) await checkIn(u.id, day(i))
    expect((await mine(u.id)).filter((b) => b.startsWith('streak')).sort()).toEqual(['streak_3', 'streak_7'])
    for (let i = 7; i < 30; i++) await checkIn(u.id, day(i))
    expect((await mine(u.id)).filter((b) => b.startsWith('streak')).sort()).toEqual(['streak_3', 'streak_30', 'streak_7'])
    await checkIn(u.id, day(60))                                                                // a long gap resets the streak, not the badges
    expect((await mine(u.id)).filter((b) => b.startsWith('streak'))).toHaveLength(3)
  })

  test('invite badges at 1, 3 and 10 friends who really joined', async () => {
    const u = await makeUser('Amina') as U
    const pay = async (n: number) => { for (let i = 0; i < n; i++) await award(u.id, 'invite_friend', `invite:f${Math.random()}`) ; await syncBadges(u.id) }
    await pay(1); expect((await mine(u.id)).filter((b) => /invite|crew|community|first_invite/.test(b))).toEqual(['first_invite'])
    await pay(1); expect(await mine(u.id)).not.toContain('crew_builder')                         // two friends: not yet
    await pay(1); expect(await mine(u.id)).toContain('crew_builder'); expect(await mine(u.id)).not.toContain('community_builder')
    await pay(6); expect(await mine(u.id)).not.toContain('community_builder')                    // nine: not yet
    await pay(1); expect(await mine(u.id)).toContain('community_builder')
  })

  test('a first approved Study or Friends photo earns Face of campus, even after it is later replaced', async () => {
    const u = await makeUser('Amina') as U; const S = await adminLogin(await makeAdmin())
    const [p] = await db.insert(profilePhotos).values({ userId: u.id, intent: 'study', storageKey: 'photos/a.webp', status: 'pending' }).returning()
    await adminCall('POST', '/admin/photos/resolve', { photoId: p!.id, action: 'approve' }, { session: S })
    expect(await mine(u.id)).toContain('face_of_campus')
    await db.update(profilePhotos).set({ status: 'replaced' }).where(eq(profilePhotos.id, p!.id))
    await db.delete(userBadges).where(eq(userBadges.userId, u.id))
    await syncBadges(u.id)
    expect(await mine(u.id)).toContain('face_of_campus')                                         // a replaced photo was still approved once
  })
})

describe('earned once, retroactively, and announced', () => {
  test('granting is idempotent: a second sync grants nothing and keeps the original date', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await connect(a, b)
    const first = (await db.select().from(userBadges).where(eq(userBadges.userId, a.id))).find((x) => x.badge === 'connector')!
    expect(await syncBadges(a.id)).toEqual([])
    const again = (await db.select().from(userBadges).where(eq(userBadges.userId, a.id))).find((x) => x.badge === 'connector')!
    expect(+again.earnedAt).toBe(+first.earnedAt)
  })

  test('something done before badges existed is noticed on the next check-in', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    const [x, y] = orderedPair(a.id, b.id)
    await db.insert(connectionRequests).values({ intent: 'study', fromUserId: a.id, toUserId: b.id, status: 'accepted' })
    await db.insert(conversations).values({ intent: 'study', userAId: x, userBId: y })           // history from before: no hook ever ran
    expect(await mine(a.id)).toEqual([])
    await checkIn(a.id, at('2026-03-01'))
    expect(await mine(a.id)).toEqual(expect.arrayContaining(['connector', 'study_buddy', 'welcome']))
  })

  test('each new badge is announced to the student once, and not again', async () => {
    const seen: { topic: string; payload: any }[] = []
    bus.attach((topic, payload) => seen.push({ topic, payload }))
    try {
      const a = await makeUser('Amina') as U
      await syncBadges(a.id)
      const badges = seen.filter((s) => s.payload.type === 'badge.earned' && s.topic === `user:${a.id}`).map((s) => s.payload.badge)
      expect(badges).toEqual(['welcome'])
      await syncBadges(a.id)
      expect(seen.filter((s) => s.payload.type === 'badge.earned')).toHaveLength(1)
    } finally { bus.attach(() => {}) }
  })

  test('the push notification says only that a badge was earned, never which', () => {
    const n = noticeFor({ type: 'badge.earned', badge: 'study_buddy' })!
    expect(n).toMatchObject({ kind: 'badge', body: 'You earned a new badge', url: '/progress' })
    expect(JSON.stringify(n)).not.toMatch(/study|buddy/i)
  })
})

describe('the shelf in the app', () => {
  test('lists every badge with what is earned and what is new; viewing clears "new"; unread carries the new ones', async () => {
    expect((await call(null, 'GET', '/me/badges')).status).toBe(401)
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await connect(a, b)
    const shelf = (await call(a, 'GET', '/me/badges')).json
    expect(shelf).toMatchObject({ earned: 3, total: 16 })
    expect(shelf.badges).toHaveLength(16)
    const connector = shelf.badges.find((x: any) => x.id === 'connector')
    expect(connector).toMatchObject({ name: 'Connector', how: 'Make your first connection.', isNew: true }); expect(connector.earnedAt).not.toBeNull()
    expect(shelf.badges.find((x: any) => x.id === 'meetup')).toMatchObject({ earnedAt: null, isNew: false })
    const unread = (await call(a, 'GET', '/me/unread')).json
    expect(unread.badges.map((x: any) => x.name).sort()).toEqual(['Connector', 'Study buddy', 'Welcome'])
    await call(a, 'POST', '/me/badges/seen')
    expect((await call(a, 'GET', '/me/unread')).json.badges).toEqual([])
    expect((await call(a, 'GET', '/me/badges')).json.badges.every((x: any) => !x.isNew)).toBe(true)
    expect((await call(b, 'GET', '/me/unread')).json.badges).toHaveLength(3)                       // seeing them is personal: Tunde's are still new
  })

  test('the Progress summary counts them', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await connect(a, b)
    expect((await call(a, 'GET', '/me/progress')).json.badges).toEqual({ earned: 3, total: 16 })
  })
})

describe('staff', () => {
  test('revoking needs a reason and a staff session, is audited, hides the badge and is never undone by a sync', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await connect(a, b)
    const S = await adminLogin(await makeAdmin()); const A = (m: string, p: string, body?: unknown) => adminCall(m, p, body, { session: S })
    const path = `/admin/users/${a.id}/badges/connector/revoke`
    expect((await adminCall('POST', path, { note: 'abuse here' })).status).toBe(401)
    expect((await A('POST', path, { note: 'no' })).status).toBe(422)
    expect((await A('POST', `/admin/users/${a.id}/badges/not_a_badge/revoke`, { note: 'does not exist' })).status).toBe(404)
    expect((await A('POST', path, { note: 'Farming connections with fake accounts' })).status).toBe(200)
    expect((await A('POST', path, { note: 'Farming connections with fake accounts' })).status).toBe(404)   // already revoked
    expect(await mine(a.id)).not.toContain('connector')
    expect((await call(a, 'GET', '/me/badges')).json.badges.find((x: any) => x.id === 'connector').earnedAt).toBeNull()
    await syncBadges(a.id); await checkIn(a.id, at('2026-03-01'))
    expect(await mine(a.id)).not.toContain('connector')                                                      // not re-granted
    const view = (await A('GET', `/admin/users/${a.id}`)).json.rewards.badges
    expect(view.find((x: any) => x.id === 'connector')).toMatchObject({ revoked: true, revokedNote: 'Farming connections with fake accounts' })
    expect((await db.select().from(adminAudit)).some((r) => r.action === 'badge.revoke' && r.meta?.includes('connector'))).toBe(true)
  })

  test('deleting an account removes its badges', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await connect(a, b)
    await db.delete(users).where(eq(users.id, a.id))
    expect(await db.select().from(userBadges).where(eq(userBadges.userId, a.id))).toHaveLength(0)
    expect((await mine(b.id)).length).toBe(3)
  })
})
