import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq, isNull } from 'drizzle-orm'
import { adminAudit, dailyCheckins, intentProfiles, pointEvents, profilePhotos, userProgress, users } from '@moc/db'
import { db } from '../src/context'
import { devOutbox } from '../src/email'
import { award, checkIn, progressOf, qualifyInvite } from '../src/rewards/engine'
import { addDays, daysBetween, nextMonthStart, watDay, watMonth } from '../src/rewards/time'
import { adminCall, adminLogin, call, makeAdmin, makeUser, resetAll } from './helpers'

beforeEach(resetAll)
type U = { id: string; token: string; email: string }
const at = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`)
const progress = async (id: string) => (await db.select().from(userProgress).where(eq(userProgress.userId, id)))[0]
const events = (id: string) => db.select().from(pointEvents).where(eq(pointEvents.userId, id))
const kinds = async (id: string) => (await events(id)).map((e) => e.kind).sort()
/** The stored total must always equal the sum of the live ledger. */
async function consistent(id: string) {
  const live = (await db.select().from(pointEvents).where(and(eq(pointEvents.userId, id), isNull(pointEvents.reversedAt)))).reduce((n, e) => n + e.points, 0)
  expect((await progress(id))?.pointsTotal ?? 0).toBe(live)
}

describe('the Nigerian day', () => {
  test('a day is UTC+1: 23:30 UTC is already tomorrow in Nigeria', () => {
    expect(watDay(at('2026-03-01', 12))).toBe('2026-03-01')
    expect(watDay(new Date('2026-03-01T22:59:59Z'))).toBe('2026-03-01')
    expect(watDay(new Date('2026-03-01T23:00:00Z'))).toBe('2026-03-02')
    expect(watDay(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01')
    expect(watMonth(new Date('2026-02-28T23:30:00Z'))).toBe('2026-03')
  })
  test('day arithmetic', () => {
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3); expect(addDays('2026-02-28', 1)).toBe('2026-03-01'); expect(nextMonthStart('2026-12')).toBe('2027-01-01')
  })
})

describe('daily check-in and streaks', () => {
  test('the first check-in starts a streak and pays 5; the same day again pays nothing', async () => {
    const u = await makeUser('Amina') as U
    const a = await checkIn(u.id, at('2026-03-01'))
    expect(a).toMatchObject({ alreadyCheckedIn: false, streak: { current: 1, best: 1 }, pointsTotal: 5, awarded: [{ kind: 'checkin', points: 5 }] })
    const b = await checkIn(u.id, at('2026-03-01', 20))
    expect(b).toMatchObject({ alreadyCheckedIn: true, awarded: [], pointsTotal: 5, streak: { current: 1 } })
    await consistent(u.id)
  })

  test('a day is a Nigerian day: 23:30 UTC and 00:10 UTC are the same check-in day', async () => {
    const u = await makeUser('Amina') as U
    expect((await checkIn(u.id, new Date('2026-03-01T23:30:00Z'))).alreadyCheckedIn).toBe(false)   // 2 March in Nigeria
    expect((await checkIn(u.id, new Date('2026-03-02T00:10:00Z'))).alreadyCheckedIn).toBe(true)    // still 2 March
    expect((await checkIn(u.id, new Date('2026-03-03T00:10:00Z'))).streak.current).toBe(2)         // 3 March
  })

  test('consecutive days build the streak, with each milestone paid once: 3 days +10, 7 days +25', async () => {
    const u = await makeUser('Amina') as U
    const days = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07']
    const out = []
    for (const d of days) out.push(await checkIn(u.id, at(d)))
    expect(out.map((o) => o.streak.current)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(out[2]!.awarded.map((a) => a.kind).sort()).toEqual(['checkin', 'streak_3'])
    expect(out[6]!.awarded.map((a) => a.kind).sort()).toEqual(['checkin', 'streak_7'])
    expect((await progress(u.id))!.pointsTotal).toBe(7 * 5 + 10 + 25)
    await consistent(u.id)
  })

  test('a milestone never pays twice, even after the streak is lost and rebuilt', async () => {
    const u = await makeUser('Amina') as U
    for (const d of ['2026-03-01', '2026-03-02', '2026-03-03']) await checkIn(u.id, at(d))
    await checkIn(u.id, at('2026-03-10'))                                                           // a long gap: starts again
    for (const d of ['2026-03-11', '2026-03-12']) await checkIn(u.id, at(d))                         // 3 days again
    expect((await kinds(u.id)).filter((k) => k === 'streak_3')).toHaveLength(1)
    expect((await progress(u.id))).toMatchObject({ streakCurrent: 3, streakBest: 3 })
  })

  test('one missed day is forgiven once a week (a rest day); the second one that week is not', async () => {
    const u = await makeUser('Amina') as U
    await checkIn(u.id, at('2026-03-01'))
    const bridged = await checkIn(u.id, at('2026-03-03'))                                           // missed the 2nd
    expect(bridged).toMatchObject({ restUsed: true, streak: { current: 2 } })
    const again = await checkIn(u.id, at('2026-03-05'))                                             // missed the 4th, within 7 days of the rest
    expect(again).toMatchObject({ restUsed: false, streak: { current: 1, best: 2 } })               // starts again, best remembered
    // a week after the rest day it is available again
    await checkIn(u.id, at('2026-03-06')); await checkIn(u.id, at('2026-03-07')); await checkIn(u.id, at('2026-03-08'))
    expect((await checkIn(u.id, at('2026-03-10')))).toMatchObject({ restUsed: true })              // rest was on the 2nd; the 9th is 7 days on
  })

  test('two or more missed days always start again from one', async () => {
    const u = await makeUser('Amina') as U
    for (const d of ['2026-03-01', '2026-03-02', '2026-03-03']) await checkIn(u.id, at(d))
    expect((await checkIn(u.id, at('2026-03-06'))).streak).toEqual({ current: 1, best: 3 })
  })

  test('check-ins from many tabs at once count one day once', async () => {
    const u = await makeUser('Amina') as U
    const results = await Promise.all(Array.from({ length: 8 }, () => checkIn(u.id, at('2026-03-01'))))
    expect(results.filter((r) => !r.alreadyCheckedIn)).toHaveLength(1)
    expect((await events(u.id)).filter((e) => e.kind === 'checkin')).toHaveLength(1)
    expect(await db.select().from(dailyCheckins).where(eq(dailyCheckins.userId, u.id))).toHaveLength(1)
    await consistent(u.id)
  })

  test('the endpoint needs a sign-in and shows today', async () => {
    expect((await call(null, 'POST', '/me/checkin')).status).toBe(401)
    const u = await makeUser('Amina') as U
    const r = await call(u, 'POST', '/me/checkin')
    expect(r.status).toBe(200); expect(r.json).toMatchObject({ streak: { current: 1 }, pointsTotal: 5 })
    expect((await call(u, 'GET', '/me/progress')).json).toMatchObject({ points: 5, streak: { current: 1, checkedInToday: true } })
  })
})

describe('caps and never-twice', () => {
  test('the same award can never be paid twice', async () => {
    const u = await makeUser('Amina') as U
    expect(await award(u.id, 'connection', 'conn:abc')).toEqual({ kind: 'connection', points: 5 })
    expect(await award(u.id, 'connection', 'conn:abc')).toBeNull()
    expect(await events(u.id)).toHaveLength(1); await consistent(u.id)
  })

  test('per-kind daily limits, and an overall daily cap of 60 on the things you can repeat', async () => {
    const u = await makeUser('Amina') as U
    const now = at('2026-03-01')
    for (let i = 0; i < 5; i++) expect(await award(u.id, 'connection', `c${i}`, now)).not.toBeNull()   // 25
    expect(await award(u.id, 'connection', 'c5', now)).toBeNull()                                      // a sixth connection today: no
    for (let i = 0; i < 3; i++) expect(await award(u.id, 'room_joined', `r${i}`, now)).not.toBeNull()  // 30 -> 55
    expect(await award(u.id, 'room_joined', 'r3', now)).toBeNull()                                     // a fourth room: no
    expect(await award(u.id, 'checkin', 'checkin:x', now)).not.toBeNull()                              // 60
    expect(await award(u.id, 'meetup_accepted', 'm0', now)).toBeNull()                                 // would make 75: over the cap
    expect((await progress(u.id))!.pointsTotal).toBe(60)
    expect(await award(u.id, 'meetup_accepted', 'm1', at('2026-03-02'))).not.toBeNull()                // tomorrow is fresh
    await consistent(u.id)
  })

  test('one-time awards are not held back by the daily cap', async () => {
    const u = await makeUser('Amina') as U; const now = at('2026-03-01')
    for (let i = 0; i < 5; i++) await award(u.id, 'connection', `c${i}`, now)
    for (let i = 0; i < 3; i++) await award(u.id, 'room_joined', `r${i}`, now)
    await award(u.id, 'checkin', 'checkin:x', now)
    expect(await award(u.id, 'onboarding', 'onboarding', now)).not.toBeNull()                          // 80 today, by design
  })
})

describe('what earns points, and Romance never does', () => {
  test('finishing setup pays once; a full Study or Friends profile pays once; a Romance profile never counts as complete', async () => {
    const u = await makeUser('Amina', { modes: [] }) as U
    const body = { enabled: true, prompt: 'hi', bio: 'about me', tags: ['CSS 411'] }
    await call(u, 'PUT', '/me/profiles/romance', body)
    expect(await kinds(u.id)).toEqual(['onboarding'])                                                   // setup counts; "complete" does not, for Romance
    await call(u, 'PUT', '/me/profiles/study', { enabled: true, prompt: 'x' })
    expect(await kinds(u.id)).toEqual(['onboarding'])                                                   // incomplete: no
    await call(u, 'PUT', '/me/profiles/study', body); await call(u, 'PUT', '/me/profiles/friends', body)
    expect((await kinds(u.id)).sort()).toEqual(['onboarding', 'profile_complete'])                      // once each
    await consistent(u.id)
  })

  test('connections: both people earn 5 (and 20 more on their first); Romance earns nothing', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U, c = await makeUser('Chidi') as U
    const first = (await call(a, 'POST', '/connections', { toUserId: b.id, intent: 'study' })).json
    await call(b, 'PATCH', `/connections/${first.requestId}`, { status: 'accepted' })
    for (const u of [a, b]) expect((await progress(u.id))!.pointsTotal).toBe(25)
    const second = (await call(a, 'POST', '/connections', { toUserId: c.id, intent: 'study' })).json
    await call(c, 'PATCH', `/connections/${second.requestId}`, { status: 'accepted' })
    expect((await progress(a.id))!.pointsTotal).toBe(30); expect((await progress(c.id))!.pointsTotal).toBe(25)
    expect((await kinds(a.id)).filter((k) => k === 'first_connection')).toHaveLength(1)
    await consistent(a.id)
  })

  test('connections that cross (they invited you, you invited them) connect once and pay once each', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await call(a, 'POST', '/connections', { toUserId: b.id, intent: 'study' })
    const back = await call(b, 'POST', '/connections', { toUserId: a.id, intent: 'study' })
    expect(back.json.matched).toBe(true)
    for (const u of [a, b]) expect((await progress(u.id))!.pointsTotal).toBe(25)
  })

  test('Romance connections, meetups and photos earn nothing and do not start anything', async () => {
    const a = await makeUser('Amina', { modes: ['romance'], department: 'Cyber Security' }) as U, b = await makeUser('Tunde', { modes: ['romance'], department: 'Computer Science' }) as U
    const r = (await call(a, 'POST', '/connections', { toUserId: b.id, intent: 'romance' })).json
    await call(b, 'PATCH', `/connections/${r.requestId}`, { status: 'accepted' })
    const when = new Date(Date.now() + 3_600_000).toISOString()
    const m = (await call(a, 'POST', `/conversations/${r.conversationId}/messages`, { kind: 'meetup', where: 'University Library', when })).json.message
    await call(b, 'PATCH', `/messages/${m.id}/meetup`, { status: 'confirmed' })
    await db.insert(profilePhotos).values({ userId: a.id, intent: 'romance', storageKey: 'photos/x/y.webp', status: 'pending' })
    const S = await adminLogin(await makeAdmin())
    const pid = (await db.select().from(profilePhotos).where(eq(profilePhotos.userId, a.id)))[0]!.id
    await adminCall('POST', '/admin/photos/resolve', { photoId: pid, action: 'approve' }, { session: S })
    for (const u of [a, b]) expect(await events(u.id)).toHaveLength(0)
  })

  test('meetups in Study and Friends: both people earn 15 when it is agreed, nothing if declined', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    const inv = (await call(a, 'POST', '/connections', { toUserId: b.id, intent: 'study' })).json
    await call(b, 'PATCH', `/connections/${inv.requestId}`, { status: 'accepted' })
    const base = (await progress(a.id))!.pointsTotal
    const when = new Date(Date.now() + 3_600_000).toISOString()
    const m1 = (await call(a, 'POST', `/conversations/${inv.conversationId}/messages`, { kind: 'meetup', where: 'University Library', when })).json.message
    const m2 = (await call(a, 'POST', `/conversations/${inv.conversationId}/messages`, { kind: 'meetup', where: 'ICT Centre', when })).json.message
    await call(b, 'PATCH', `/messages/${m1.id}/meetup`, { status: 'declined' })
    expect((await progress(a.id))!.pointsTotal).toBe(base)
    await call(b, 'PATCH', `/messages/${m2.id}/meetup`, { status: 'confirmed' })
    for (const u of [a, b]) expect((await progress(u.id))!.pointsTotal).toBe(base + 15)
  })

  test('rooms: a member earns 10 for a place; the host earns 20 once, when two others are in; hosting alone earns nothing', async () => {
    const host = await makeUser('Host') as U, g1 = await makeUser('G1') as U, g2 = await makeUser('G2') as U
    const future = new Date(Date.now() + 2 * 3_600_000).toISOString()
    const room = (await call(host, 'POST', '/rooms', { intent: 'study', tag: 'X', title: 'T', place: 'University Library', startsAt: new Date().toISOString(), endsAt: future, capacity: 5 })).json.room.id
    expect((await events(host.id))).toHaveLength(0)
    await call(g1, 'POST', `/rooms/${room}/request`); await call(g2, 'POST', `/rooms/${room}/request`)
    await call(host, 'POST', `/rooms/${room}/requests/${g1.id}`, { decision: 'approved' })
    expect((await progress(g1.id))!.pointsTotal).toBe(10); expect(await events(host.id)).toHaveLength(0)  // one guest: not yet
    await call(host, 'POST', `/rooms/${room}/requests/${g2.id}`, { decision: 'approved' })
    expect(await kinds(host.id)).toEqual(['room_hosted'])
    await call(host, 'POST', `/rooms/${room}/requests/${g2.id}`, { decision: 'approved' })               // answering again changes nothing
    expect(await events(host.id)).toHaveLength(1); expect(await events(g2.id)).toHaveLength(1)
  })

  test('a first approved Study or Friends photo pays 20 once; a replacement pays nothing more', async () => {
    const u = await makeUser('Amina') as U; const S = await adminLogin(await makeAdmin())
    for (let i = 0; i < 2; i++) {
      const [p] = await db.insert(profilePhotos).values({ userId: u.id, intent: 'study', storageKey: `photos/${u.id}/${i}.webp`, status: 'pending' }).returning()
      await adminCall('POST', '/admin/photos/resolve', { photoId: p!.id, action: 'approve' }, { session: S })
    }
    expect((await events(u.id)).filter((e) => e.kind === 'photo_approved')).toHaveLength(1)
    expect((await progress(u.id))!.pointsTotal).toBe(20)
  })
})

describe('inviting friends', () => {
  async function signUp(email: string, invite?: string) {
    await call(null, 'POST', '/auth/request-code', { email })
    const code = devOutbox.filter((m) => m.to === email).at(-1)!.code
    const r = await call(null, 'POST', '/auth/verify', { email, code, ...(invite ? { invite } : {}) })
    return { r, user: (await db.select().from(users).where(eq(users.email, email)))[0]! }
  }
  const codeOf = async (u: U) => (await db.select({ c: users.inviteCode }).from(users).where(eq(users.id, u.id)))[0]!.c

  test('everyone has a personal link, and it stays the same', async () => {
    const u = await makeUser('Amina') as U
    const p = (await call(u, 'GET', '/me/progress')).json.invite
    expect(p.code).toMatch(/^[a-f0-9]{10}$/); expect(p.url).toBe(`http://localhost:3000/login?invite=${p.code}`)
    expect((await call(u, 'GET', '/me/progress')).json.invite.code).toBe(p.code)
    expect(p).toMatchObject({ invited: 0, rewarded: 0, pending: 0, monthUsed: 0, monthMax: 10 })
  })

  test('a new account made through a link is attributed; an existing member, a made-up code and a suspended inviter are not', async () => {
    const inviter = await makeUser('Amina') as U, existing = await makeUser('Tunde') as U, gone = await makeUser('Gone') as U
    const code = await codeOf(inviter)
    const a = await signUp('new.one@st.futminna.edu.ng', code); expect(a.user.referredBy).toBe(inviter.id)
    const b = await signUp(existing.email, code); expect(b.user.referredBy).toBeNull()                    // already a member: unchanged
    const c = await signUp('made.up@st.futminna.edu.ng', 'abcdef0123'); expect(c.r.status).toBe(200); expect(c.user.referredBy).toBeNull()
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, gone.id))
    const d = await signUp('x.y@st.futminna.edu.ng', await codeOf(gone)); expect(d.user.referredBy).toBeNull()
    expect((await call(null, 'POST', '/auth/verify', { email: 'z@st.futminna.edu.ng', code: '123456', invite: 'NOT-A-CODE' })).status).toBe(422)   // malformed code is rejected, not trusted
    expect((await call(inviter, 'GET', '/me/progress')).json.invite).toMatchObject({ invited: 1, pending: 1, rewarded: 0 })
  })

  async function invitedFriend(inviter: U, email = 'friend@st.futminna.edu.ng') {
    const { user } = await signUp(email, await codeOf(inviter))
    return user
  }
  const setUp = (id: string) => db.insert(intentProfiles).values({ userId: id, intent: 'study', enabled: true })
  const threeDays = async (id: string, from = '2026-03-01') => { for (let i = 0; i < 3; i++) await checkIn(id, at(addDays(from, i))) }

  test('the friend counts only once they have set up and opened the app on 3 different days; then both earn 30, once', async () => {
    const inviter = await makeUser('Amina') as U
    const friend = await invitedFriend(inviter)
    await checkIn(friend.id, at('2026-03-01')); await checkIn(friend.id, at('2026-03-02'))
    expect(await qualifyInvite(friend.id, at('2026-03-02'))).toEqual([])                                 // two days: not yet
    await checkIn(friend.id, at('2026-03-03'))
    expect((await kinds(inviter.id))).toEqual([])                                                        // three days but never set up: no
    await setUp(friend.id)
    expect((await qualifyInvite(friend.id, at('2026-03-03')))).toEqual([{ kind: 'invited_by_friend', points: 30 }])
    expect(await kinds(inviter.id)).toEqual(['invite_friend'])
    await qualifyInvite(friend.id); await qualifyInvite(friend.id)                                      // again and again: nothing more
    expect((await events(inviter.id)).filter((e) => e.kind === 'invite_friend')).toHaveLength(1)
    expect((await events(friend.id)).filter((e) => e.kind === 'invited_by_friend')).toHaveLength(1)
    expect((await progressOf(inviter.id, at('2026-03-10'))).invite).toMatchObject({ invited: 1, rewarded: 1, pending: 0, monthUsed: 1 })   // (progress for March, when it was earned)
    await consistent(inviter.id); await consistent(friend.id)
  })

  test('it happens by itself on the friend\'s third check-in', async () => {
    const inviter = await makeUser('Amina') as U; const friend = await invitedFriend(inviter); await setUp(friend.id)
    await checkIn(friend.id, at('2026-03-01')); await checkIn(friend.id, at('2026-03-02'))
    const third = await checkIn(friend.id, at('2026-03-03'))
    expect(third.awarded.map((a) => a.kind)).toContain('invited_by_friend')
    expect((await progress(inviter.id))!.pointsTotal).toBe(30)
  })

  test('a suspended inviter earns nothing, but the friend still gets their bonus', async () => {
    const inviter = await makeUser('Amina') as U; const friend = await invitedFriend(inviter); await setUp(friend.id)
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, inviter.id))
    await threeDays(friend.id)                                                                           // the friend's third day is when it would pay
    expect(await events(inviter.id)).toHaveLength(0); expect(await kinds(friend.id)).toContain('invited_by_friend')
  })

  test('the inviter earns for at most 10 friends a month, and the friends still earn their own bonus', async () => {
    const inviter = await makeUser('Amina') as U
    const friends = []
    for (let i = 0; i < 11; i++) { const f = await invitedFriend(inviter, `friend${i}@st.futminna.edu.ng`); await setUp(f.id); friends.push(f) }
    for (const f of friends) { await threeDays(f.id, '2026-03-01'); await qualifyInvite(f.id, at('2026-03-05')) }
    expect((await events(inviter.id)).filter((e) => e.kind === 'invite_friend')).toHaveLength(10)
    for (const f of friends) expect((await kinds(f.id))).toContain('invited_by_friend')                  // all 11 friends got theirs
    // the month turns over: the eleventh can now be paid
    await qualifyInvite(friends[10]!.id, at('2026-04-02'))
    expect((await events(inviter.id)).filter((e) => e.kind === 'invite_friend')).toHaveLength(11)
  })
})

describe('staff', () => {
  test('staff see a student\'s points, streak, ledger and inviter; reversing needs a reason, is audited and cannot be repeated', async () => {
    const inviter = await makeUser('Amina') as U, u = await makeUser('Tunde') as U
    await db.update(users).set({ referredBy: inviter.id }).where(eq(users.id, u.id))
    await checkIn(u.id, at('2026-03-01'))
    const S = await adminLogin(await makeAdmin()); const A = (m: string, p: string, b?: unknown) => adminCall(m, p, b, { session: S })
    const view = (await A('GET', `/admin/users/${u.id}`)).json.rewards
    expect(view).toMatchObject({ points: 5, streakCurrent: 1, referredBy: { id: inviter.id, name: 'Amina' }, invited: 0 })
    expect(view.ledger[0]).toMatchObject({ kind: 'checkin', label: 'Daily check-in', points: 5, reversed: false })
    const id = view.ledger[0].id
    expect((await adminCall('POST', `/admin/points/${id}/reverse`, { note: 'abuse' })).status).toBe(401)                // staff only
    expect((await A('POST', `/admin/points/${id}/reverse`, { note: 'no' })).status).toBe(422)                            // reason required
    expect((await A('POST', `/admin/points/${id}/reverse`, { note: 'Farming points with extra accounts' })).status).toBe(200)
    expect((await A('POST', `/admin/points/${id}/reverse`, { note: 'Farming points with extra accounts' })).status).toBe(409)
    expect((await progress(u.id))!.pointsTotal).toBe(0); await consistent(u.id)
    expect((await A('GET', `/admin/users/${u.id}`)).json.rewards.ledger[0]).toMatchObject({ reversed: true, reversalNote: 'Farming points with extra accounts' })
    expect((await db.select().from(adminAudit)).some((a) => a.action === 'points.reverse' && a.meta?.includes('checkin'))).toBe(true)
    expect(await award(u.id, 'checkin', 'checkin:2026-03-01', at('2026-03-01'))).toBeNull()                            // a reversed award is not re-paid
    expect((await A('POST', `/admin/points/${crypto.randomUUID()}/reverse`, { note: 'unknown id here' })).status).toBe(404)
  })

  test('reversed points stop counting toward the daily cap', async () => {
    const u = await makeUser('Amina') as U; const now = at('2026-03-01')
    for (let i = 0; i < 5; i++) await award(u.id, 'connection', `c${i}`, now)
    expect(await award(u.id, 'connection', 'c5', now)).toBeNull()
    const S = await adminLogin(await makeAdmin()); const first = (await events(u.id))[0]!
    await adminCall('POST', `/admin/points/${first.id}/reverse`, { note: 'duplicate account' }, { session: S })
    expect(await award(u.id, 'connection', 'c6', now)).not.toBeNull()
  })
})

describe('deleting an account', () => {
  test('removes the points, check-ins and progress, and leaves the people they invited unharmed', async () => {
    const inviter = await makeUser('Amina') as U, friend = await makeUser('Tunde') as U
    await db.update(users).set({ referredBy: inviter.id }).where(eq(users.id, friend.id))
    await checkIn(inviter.id, at('2026-03-01')); await checkIn(friend.id, at('2026-03-01'))
    await db.delete(users).where(eq(users.id, inviter.id))
    expect(await db.select().from(pointEvents).where(eq(pointEvents.userId, inviter.id))).toHaveLength(0)
    expect(await db.select().from(userProgress).where(eq(userProgress.userId, inviter.id))).toHaveLength(0)
    expect(await db.select().from(dailyCheckins).where(eq(dailyCheckins.userId, inviter.id))).toHaveLength(0)
    expect((await db.select().from(users).where(eq(users.id, friend.id)))[0]!.referredBy).toBeNull()
    expect((await progress(friend.id))!.pointsTotal).toBe(5)
  })
})
