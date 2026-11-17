import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { adminAudit, campusSpots, departments, intentProfiles, users } from '@moc/db'
import { db } from '../src/context'
import { adminCall, adminLogin, call, makeAdmin, makeUser, resetAll } from './helpers'

let S: string
const A = (m: string, p: string, body?: unknown) => adminCall(m, p, body, { session: S })
const future = () => new Date(Date.now() + 3600_000).toISOString()

beforeEach(async () => { await resetAll(); S = await adminLogin(await makeAdmin()) })

describe('what students are offered (/meta)', () => {
  test('returns the campus lists and the usually-free presets', async () => {
    const u = await makeUser('Amina')
    const m = (await call(u, 'GET', '/meta')).json
    expect(m.departments).toEqual(['Cyber Security', 'Computer Science', 'Information Technology', 'Electrical Engineering'])
    expect(m.spots).toContain('University Library')
    expect(m.freeTimes).toContain('Weekday mornings')
    expect((await call(null, 'GET', '/meta')).status).toBe(401)
  })

  test('global entries show everywhere, campus entries only on their campus, archived entries nowhere', async () => {
    const amina = await makeUser('Amina'), far = await makeUser('Far', { university: 'unilag' })
    await db.insert(departments).values({ name: 'Marine Biology', university: 'unilag', sortOrder: 5 })
    await db.insert(campusSpots).values({ name: 'Jelili Omotola Hall', university: 'unilag', sortOrder: 5 })
    await db.update(campusSpots).set({ active: false }).where(eq(campusSpots.name, 'School Field'))
    const mine = (await call(amina, 'GET', '/meta')).json, theirs = (await call(far, 'GET', '/meta')).json
    expect(mine.departments).not.toContain('Marine Biology'); expect(theirs.departments[0]).toBe('Marine Biology')
    expect(mine.spots).not.toContain('Jelili Omotola Hall'); expect(theirs.spots).toContain('Jelili Omotola Hall')
    expect(mine.spots).not.toContain('School Field'); expect(theirs.spots).not.toContain('School Field')
  })
})

describe('validation against the lists', () => {
  test('a department must come from the campus list, in the list\'s own spelling', async () => {
    const u = await makeUser('Amina', { department: 'Cyber Security' })
    expect((await call(u, 'PATCH', '/me', { department: 'Made Up Dept' })).status).toBe(422)
    const ok = await call(u, 'PATCH', '/me', { department: 'computer science' })
    expect(ok.status).toBe(200); expect(ok.json.user.department).toBe('Computer Science')
  })

  test('keeping a department staff later archived still saves, so other edits never get blocked', async () => {
    const u = await makeUser('Amina', { department: 'Cyber Security' })
    await db.update(departments).set({ active: false }).where(eq(departments.name, 'Cyber Security'))
    const r = await call(u, 'PATCH', '/me', { department: 'Cyber Security', name: 'Amina B' })
    expect(r.status).toBe(200); expect(r.json.user.department).toBe('Cyber Security')
    expect((await call(u, 'PATCH', '/me', { department: 'Computer Science' })).status).toBe(200) // moving to a listed one is fine
  })

  test('a usual spot must be a listed spot; an archived one you already have stays', async () => {
    const u = await makeUser('Amina')
    expect((await call(u, 'PUT', '/me/profiles/study', { usualSpot: 'My Hostel Room' })).status).toBe(422)
    expect((await call(u, 'PUT', '/me/profiles/study', { usualSpot: 'faculty quad' })).json.profile.usualSpot).toBe('Faculty Quad')
    await db.update(campusSpots).set({ active: false }).where(eq(campusSpots.name, 'Faculty Quad'))
    expect((await call(u, 'PUT', '/me/profiles/study', { usualSpot: 'Faculty Quad', prompt: 'hi' })).status).toBe(200)
    expect((await call(u, 'PUT', '/me/profiles/study', { usualSpot: '' })).status).toBe(200) // clearing is always allowed
  })

  test('usually-free accepts several presets plus a note (up to 160 chars)', async () => {
    const u = await makeUser('Amina')
    const text = 'Weekday mornings, Weekend afternoons, Lunch hours, after 6 on Fridays'
    expect((await call(u, 'PUT', '/me/profiles/study', { usuallyFree: text })).json.profile.usuallyFree).toBe(text)
    expect((await call(u, 'PUT', '/me/profiles/study', { usuallyFree: 'x'.repeat(161) })).status).toBe(422)
  })

  test('meetups follow the campus list: archived and other-campus spots are refused, spelling is normalised', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde')
    const invite = (await call(a, 'POST', '/connections', { toUserId: b.id, intent: 'study' })).json
    const conv = invite.conversationId
    await call(b, 'PATCH', `/connections/${invite.requestId}`, { status: 'accepted' }) // an unanswered invite allows only one message
    const propose = (where: string) => call(a, 'POST', `/conversations/${conv}/messages`, { kind: 'meetup', where, when: future() })
    expect((await propose('ict centre')).json.message.meetupWhere).toBe('ICT Centre')
    await db.update(campusSpots).set({ active: false }).where(eq(campusSpots.name, 'School Field'))
    expect((await propose('School Field')).status).toBe(422)
    await db.insert(campusSpots).values({ name: 'Unilag Lagoon Front', university: 'unilag' })
    expect((await propose('Unilag Lagoon Front')).status).toBe(422)
  })
})

describe('staff managing the lists', () => {
  test.each(['departments', 'spots'])('%s: needs a staff session', async (kind) => {
    expect((await adminCall('GET', `/admin/${kind}`)).status).toBe(401)
    expect((await adminCall('POST', `/admin/${kind}`, { name: 'Anything' })).status).toBe(401)
  })

  test.each([['departments', 'Statistics'], ['spots', 'Medical Centre Lawn']])('%s: add, list with campus choices, refuse duplicates', async (kind, name) => {
    await makeUser('Amina')
    expect((await A('POST', `/admin/${kind}`, { name: `  ${name}   ` })).status).toBe(200)
    expect((await A('POST', `/admin/${kind}`, { name: name.toUpperCase() })).status).toBe(409) // case-insensitive
    expect((await A('POST', `/admin/${kind}`, { name, university: 'futminna' })).status).toBe(200) // same name, one campus: allowed
    const list = (await A('GET', `/admin/${kind}`)).json
    expect(list.items.map((i: any) => i.name)).toContain(name)
    expect(list.campuses).toContain('futminna')
    expect(list.items.at(-1).university).toBe('futminna')
  })

  test('rejects empty, one-character and markup-like names', async () => {
    for (const name of ['', ' ', 'A', '<script>x</script>', 'ab\u0000cd', 'x'.repeat(61)]) {
      expect((await A('POST', '/admin/departments', { name })).status).toBe(422)
    }
  })

  test('renaming a department updates every student who has it', async () => {
    const a = await makeUser('Amina', { department: 'Cyber Security' }), b = await makeUser('Tunde', { department: 'Computer Science' })
    const id = (await A('GET', '/admin/departments')).json.items.find((i: any) => i.name === 'Cyber Security').id
    expect((await A('PATCH', `/admin/departments/${id}`, { name: 'Cybersecurity' })).status).toBe(200)
    expect((await db.select().from(users).where(eq(users.id, a.id)))[0]!.department).toBe('Cybersecurity')
    expect((await db.select().from(users).where(eq(users.id, b.id)))[0]!.department).toBe('Computer Science')
    expect((await call(a, 'GET', '/meta')).json.departments).toContain('Cybersecurity')
    const actions = (await db.select().from(adminAudit)).map((r) => r.action)
    expect(actions).toContain('department.rename')
  })

  test('renaming a spot updates profiles; a campus-only rename leaves other campuses alone', async () => {
    const a = await makeUser('Amina'), far = await makeUser('Far', { university: 'unilag' })
    await call(a, 'PUT', '/me/profiles/study', { usualSpot: 'Faculty Quad' })
    await db.update(intentProfiles).set({ usualSpot: 'Faculty Quad' }).where(eq(intentProfiles.userId, far.id))
    const [scoped] = await db.insert(campusSpots).values({ name: 'Faculty Quad', university: 'futminna' }).returning()
    await A('PATCH', `/admin/spots/${scoped!.id}`, { name: 'The Quad' })
    const mine = (await db.select().from(intentProfiles).where(eq(intentProfiles.userId, a.id)))[0]!.usualSpot
    const theirs = (await db.select().from(intentProfiles).where(eq(intentProfiles.userId, far.id)))[0]!.usualSpot
    expect(mine).toBe('The Quad'); expect(theirs).toBe('Faculty Quad')
  })

  test('renaming onto an existing name is refused', async () => {
    const id = (await A('GET', '/admin/spots')).json.items.find((i: any) => i.name === 'ICT Centre').id
    expect((await A('PATCH', `/admin/spots/${id}`, { name: 'faculty quad' })).status).toBe(409)
  })

  test('archive hides it from students but keeps it on existing profiles; restore brings it back', async () => {
    const a = await makeUser('Amina', { department: 'Cyber Security' })
    const id = (await A('GET', '/admin/departments')).json.items.find((i: any) => i.name === 'Cyber Security').id
    await A('PATCH', `/admin/departments/${id}`, { active: false })
    expect((await call(a, 'GET', '/meta')).json.departments).not.toContain('Cyber Security')
    expect((await db.select().from(users).where(eq(users.id, a.id)))[0]!.department).toBe('Cyber Security')
    await A('PATCH', `/admin/departments/${id}`, { active: true })
    expect((await call(a, 'GET', '/meta')).json.departments).toContain('Cyber Security')
    const actions = (await db.select().from(adminAudit)).map((r) => r.action)
    expect(actions).toContain('department.archive'); expect(actions).toContain('department.restore')
  })

  test('shows how many students use each entry; only unused entries can be deleted', async () => {
    await makeUser('Amina', { department: 'Cyber Security' })
    const list = (await A('GET', '/admin/departments')).json.items
    const used = list.find((i: any) => i.name === 'Cyber Security'), unused = list.find((i: any) => i.name === 'Electrical Engineering')
    expect(used.inUse).toBe(1); expect(unused.inUse).toBe(0)
    const refused = await A('DELETE', `/admin/departments/${used.id}`)
    expect(refused.status).toBe(409); expect(refused.json).toEqual({ error: 'in_use', inUse: 1 })
    expect((await A('DELETE', `/admin/departments/${unused.id}`)).status).toBe(200)
    expect((await A('GET', '/admin/departments')).json.items.map((i: any) => i.name)).not.toContain('Electrical Engineering')
    expect((await db.select().from(adminAudit)).map((r) => r.action)).toContain('department.delete')
  })

  test('unknown ids and malformed ids are handled', async () => {
    expect((await A('PATCH', '/admin/spots/00000000-0000-0000-0000-000000000000', { active: false })).status).toBe(404)
    expect((await A('DELETE', '/admin/spots/not-a-uuid')).status).toBe(422)
  })
})
