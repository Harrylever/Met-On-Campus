import { beforeEach, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { intentProfiles, users } from '@moc/db'
import { db } from '../src/context'
import { call, makeUser, resetAll } from './helpers'

beforeEach(resetAll)

describe('gender storage', () => {
  test('a new student has no gender and every profile shows it by default', async () => {
    const a = await makeUser('Amina', { modes: ['study', 'friends'] })
    const [u] = await db.select().from(users).where(eq(users.id, a.id))
    const profiles = await db.select().from(intentProfiles).where(eq(intentProfiles.userId, a.id))
    expect(u!.gender).toBeNull()
    expect(profiles).toHaveLength(2)
    for (const p of profiles) expect(p.showGender).toBe(true)
  })

  test('the database refuses any gender other than male or female', async () => {
    const a = await makeUser('Amina')
    await db.execute(sql`update users set gender = 'female' where id = ${a.id}`) // a valid value is accepted
    const bad = async () => { await db.execute(sql`update users set gender = 'x' where id = ${a.id}`) }
    await expect(bad()).rejects.toThrow()
  })
})

const card = (r: { json: any }, name: string) => (r.json.cards as any[]).find((c) => c.name === name)

describe('gender on Discover cards', () => {
  test('shows gender on the card by default once set', async () => {
    const v = await makeUser('Viewer')
    await makeUser('Amara', { gender: 'female' })
    expect(card(await call(v, 'GET', '/discover?intent=study'), 'Amara').gender).toBe('female')
  })

  test('omits the gender key when not set', async () => {
    const v = await makeUser('Viewer')
    await makeUser('Tunde')
    expect('gender' in card(await call(v, 'GET', '/discover?intent=study'), 'Tunde')).toBe(false)
  })

  test("omits it when that mode's switch is off, without leaking it", async () => {
    const v = await makeUser('Viewer')
    await makeUser('Amara', { gender: 'female', showGender: false })
    const r = await call(v, 'GET', '/discover?intent=study')
    expect(card(r, 'Amara')).toBeDefined()
    expect(JSON.stringify(r.json)).not.toContain('gender')
  })

  test('the switch is per mode', async () => {
    const v = await makeUser('Viewer', { modes: ['study', 'friends'] })
    const a = await makeUser('Amara', { modes: ['study', 'friends'], gender: 'female' })
    await call(a, 'PUT', '/me/profiles/study', { showGender: false })
    expect('gender' in card(await call(v, 'GET', '/discover?intent=study'), 'Amara')).toBe(false)
    expect(card(await call(v, 'GET', '/discover?intent=friends'), 'Amara').gender).toBe('female')
  })

  test('blocked and other-campus students never appear, gender or not', async () => {
    const v = await makeUser('Viewer')
    const b = await makeUser('Blocked', { gender: 'male' })
    await makeUser('Faraway', { gender: 'female', university: 'unilag' })
    await call(v, 'POST', '/blocks', { userId: b.id })
    const r = await call(v, 'GET', '/discover?intent=study')
    expect(r.json.cards).toEqual([])
    expect(JSON.stringify(r.json)).not.toContain('gender')
  })

  test('search does not match gender', async () => {
    const v = await makeUser('Viewer')
    await makeUser('Amara', { gender: 'female' })
    expect((await call(v, 'GET', '/discover?intent=study&q=female')).json.cards).toEqual([])
  })
})

describe('setting gender', () => {
  test('PATCH /me sets gender and lets you switch between male and female', async () => {
    const a = await makeUser('Amina')
    const set = await call(a, 'PATCH', '/me', { gender: 'male' })
    expect(set.status).toBe(200)
    expect(set.json.user.gender).toBe('male')
    expect((await call(a, 'GET', '/me')).json.user.gender).toBe('male')
    const switched = await call(a, 'PATCH', '/me', { gender: 'female' })
    expect(switched.status).toBe(200)
    expect(switched.json.user.gender).toBe('female')
  })

  test('once set, gender cannot be cleared (422 gender_cannot_be_cleared) and stays as it was', async () => {
    const a = await makeUser('Amina', { gender: 'female' })
    const r = await call(a, 'PATCH', '/me', { gender: null })
    expect(r.status).toBe(422)
    expect(r.json.error).toBe('gender_cannot_be_cleared')
    expect((await call(a, 'GET', '/me')).json.user.gender).toBe('female')
  })

  test('sending gender null when none is set changes nothing and does not block saving other details', async () => {
    const a = await makeUser('Amina')
    const r = await call(a, 'PATCH', '/me', { gender: null, level: 200 })
    expect(r.status).toBe(200)
    expect(r.json.user.gender).toBeNull()
    expect(r.json.user.level).toBe(200)
  })

  test('PATCH /me refuses other values and stores nothing', async () => {
    const a = await makeUser('Amina', { gender: 'female' })
    expect((await call(a, 'PATCH', '/me', { gender: 'other' })).status).toBe(422)
    expect((await call(a, 'GET', '/me')).json.user.gender).toBe('female')
  })

  test('PUT /me/profiles/:intent ignores gender and stores nothing', async () => {
    const a = await makeUser('Amina')
    await call(a, 'PUT', '/me/profiles/study', { gender: 'male' })
    expect((await call(a, 'GET', '/me')).json.user.gender).toBeNull()
  })

  test('PUT /me/profiles/:intent saves showGender', async () => {
    const a = await makeUser('Amina')
    const r = await call(a, 'PUT', '/me/profiles/study', { showGender: false })
    expect(r.status).toBe(200)
    expect(r.json.profile.showGender).toBe(false)
  })

  test("other people's gender never comes back from the blocked list", async () => {
    const a = await makeUser('Amina')
    const b = await makeUser('Tunde', { gender: 'male' })
    await call(a, 'POST', '/blocks', { userId: b.id })
    expect(JSON.stringify((await call(a, 'GET', '/blocks')).json)).not.toContain('gender')
  })
})
