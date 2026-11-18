import { beforeEach, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { adminAudit, campusInterest, campuses, campusSpots, departments, users } from '@moc/db'
import { db, redis } from '../src/context'
import { devOutbox } from '../src/email'
import { adminCall, adminLogin, call, makeAdmin, makeUser, resetAll } from './helpers'

let S: string
const A = (m: string, p: string, body?: unknown) => adminCall(m, p, body, { session: S })
beforeEach(async () => { await resetAll(); devOutbox.length = 0; S = await adminLogin(await makeAdmin()) })
const code = (to: string) => devOutbox.filter((m) => m.to === to).at(-1)!.code
const ip = (n: number) => ({ 'x-forwarded-for': `10.1.0.${n}` })
const ask = (email: string, n = 1) => call(null, 'POST', '/auth/request-code', { email }, ip(n))
const signUp = async (email: string) => { await ask(email); return call(null, 'POST', '/auth/verify', { email, code: code(email) }) }
const interest = async (slug: string) => (await db.select().from(campusInterest).where(eq(campusInterest.slug, slug)))[0]
const openAbu = (extra: object = {}) => A('POST', '/admin/campuses', { slug: 'abu', name: 'Ahmadu Bello University', ...extra })
const names = async (u: { token: string }) => (await call(u, 'GET', '/meta')).json as { departments: string[]; spots: string[] }

describe('the allowlist', () => {
  test('a university that is not open cannot get a code, and nothing is sent', async () => {
    const r = await ask('amina@abu.edu.ng')
    expect(r.status).toBe(422); expect(r.json.error).toBe('campus_not_open')
    expect(devOutbox).toHaveLength(0)
    expect(await db.select().from(users)).toHaveLength(0)
  })

  test('the .edu.ng check still comes first, with its own error', async () => {
    expect((await ask('amina@gmail.com')).json.error).toBe('university_email_required')
    expect(await interest('gmail')).toBeUndefined()                                                // not a university: nothing counted
  })

  test('opening the campus lets its students sign up, whatever subdomain their address uses', async () => {
    expect((await openAbu()).status).toBe(200)
    for (const [i, email] of ['amina@abu.edu.ng', 'tunde@students.abu.edu.ng', 'ngozi@cs.abu.edu.ng'].entries()) {
      const res = await (async () => { await ask(email, i + 1); return call(null, 'POST', '/auth/verify', { email, code: code(email) }) })()
      expect(res.status).toBe(200); expect(res.json.user.university).toBe('abu')
    }
    expect(await db.select().from(users).where(eq(users.university, 'abu'))).toHaveLength(3)
  })

  test('other campuses are unaffected by opening one', async () => {
    await openAbu()
    expect((await ask('amina@st.futminna.edu.ng')).status).toBe(200)
    expect((await ask('bola@unn.edu.ng')).json.error).toBe('campus_not_open')
  })
})

describe('counting interest', () => {
  test('each attempt is counted by university, from any address, with no personal data kept', async () => {
    await ask('a@abu.edu.ng', 1); await ask('b@students.abu.edu.ng', 2); await ask('c@abu.edu.ng', 3); await ask('d@unn.edu.ng', 4)
    expect((await interest('abu'))!.attempts).toBe(3); expect((await interest('unn'))!.attempts).toBe(1)
    const rows = await db.select().from(campusInterest)
    expect(Object.keys(rows[0]!).sort()).toEqual(['attempts', 'lastAt', 'slug'])                  // a counter and a date: no email, name or IP
    expect(JSON.stringify(rows)).not.toMatch(/@|10\.1\.0/)
  })

  test('a rate-limited attempt is not counted, and the limit still applies', async () => {
    await ask('a@abu.edu.ng', 1)
    const again = await ask('a@abu.edu.ng', 1)                                                    // same address within a minute
    expect(again.status).toBe(429)
    expect((await interest('abu'))!.attempts).toBe(1)
  })

  test('made-up names are not recorded, and the table stops growing at 5,000 universities', async () => {
    expect((await ask('a@bad_name.edu.ng', 1)).json.error).toBe('campus_not_open')
    expect(await interest('bad_name')).toBeUndefined()
    await db.execute(sql`insert into campus_interest (slug, attempts) select 'fill' || g, 1 from generate_series(1, 5000) g`)
    await ask('a@brandnew.edu.ng', 2)
    expect(await interest('brandnew')).toBeUndefined()                                            // a new name is refused at the cap
    await ask('a@fill7.edu.ng', 3)
    expect((await interest('fill7'))!.attempts).toBe(2)                                           // one already counted still goes up
  })
})

describe('pausing a campus', () => {
  test('blocks new accounts only: students already in keep signing in and keep their session', async () => {
    await openAbu()
    const existing = await signUp('amina@abu.edu.ng')
    const token = /moc_session=([^;]+)/.exec(existing.headers.get('set-cookie')!)![1]!
    expect((await A('PATCH', '/admin/campuses/abu', { open: false })).status).toBe(200)
    expect((await call({ token }, 'GET', '/me')).status).toBe(200)                                // still signed in
    await redis.flushdb()                                                                          // the one-code-a-minute limit is not what is being tested
    expect((await ask('amina@abu.edu.ng', 2)).status).toBe(200)                                   // can sign in again
    expect((await call(null, 'POST', '/auth/verify', { email: 'amina@abu.edu.ng', code: code('amina@abu.edu.ng') })).status).toBe(200)
    const newcomer = await ask('tunde@abu.edu.ng', 3)
    expect(newcomer.status).toBe(422); expect(newcomer.json.error).toBe('campus_not_open')
    expect((await A('PATCH', '/admin/campuses/abu', { open: true })).status).toBe(200)
    await redis.flushdb()                                                                          // his earlier (rejected) try used up his one-a-minute slot
    expect((await ask('tunde@abu.edu.ng', 4)).status).toBe(200)                                   // resumed
  })

  test('a code asked for while open cannot create an account once the campus is paused', async () => {
    await openAbu()
    await ask('tunde@abu.edu.ng')
    await A('PATCH', '/admin/campuses/abu', { open: false })
    const res = await call(null, 'POST', '/auth/verify', { email: 'tunde@abu.edu.ng', code: code('tunde@abu.edu.ng') })
    expect(res.status).toBe(403); expect(res.json.error).toBe('campus_not_open')
    expect(await db.select().from(users).where(eq(users.email, 'tunde@abu.edu.ng'))).toHaveLength(0)
  })
})

describe('opening a campus (staff)', () => {
  test('needs a staff session', async () => {
    expect((await adminCall('POST', '/admin/campuses', { slug: 'abu', name: 'ABU' })).status).toBe(401)
    expect((await adminCall('GET', '/admin/campuses')).status).toBe(401)
    expect((await adminCall('PATCH', '/admin/campuses/abu', { open: false })).status).toBe(401)
  })

  test('the slug and name are checked; the slug is lowercased; a campus cannot be opened twice', async () => {
    for (const slug of ['', 'a', 'A B', 'bad--slug', '-abu', 'abu-', '../x', 'a'.repeat(41), 'ab.cd'])
      expect((await openAbu({ slug })).status).toBe(422)
    expect((await openAbu({ name: '<script>' })).status).toBe(422)
    expect((await openAbu({ slug: 'ABU' })).status).toBe(200)
    expect((await db.select().from(campuses).where(eq(campuses.slug, 'abu')))).toHaveLength(1)
    expect((await openAbu()).status).toBe(409)
    expect((await A('POST', '/admin/campuses', { slug: 'futminna', name: 'Again' })).status).toBe(409)
  })

  test('it starts from a copy of the template, and the copy is the campus\'s own', async () => {
    await openAbu()
    const abu = await makeUser('Amina', { university: 'abu' }), fut = await makeUser('Tunde')
    expect((await names(abu)).departments).toEqual(['Cyber Security', 'Computer Science', 'Information Technology', 'Electrical Engineering'])
    expect((await names(abu)).spots).toContain('ICT Centre')
    // Change ABU's list: FUTMinna is untouched, and the other way round.
    const dept = (await A('GET', '/admin/departments')).json.items
    await A('POST', '/admin/departments', { name: 'Biochemistry', university: 'abu' })
    await A('PATCH', `/admin/spots/${(await A('GET', '/admin/spots')).json.items.find((i: any) => i.name === 'ICT Centre' && i.university === 'abu').id}`, { name: 'Computer Centre' })
    await A('PATCH', `/admin/departments/${dept.find((i: any) => i.name === 'Cyber Security' && i.university === 'futminna').id}`, { active: false })
    expect((await names(abu)).departments).toContain('Biochemistry'); expect((await names(abu)).departments).toContain('Cyber Security')
    expect((await names(abu)).spots).toContain('Computer Centre'); expect((await names(abu)).spots).not.toContain('ICT Centre')
    expect((await names(fut)).departments).not.toContain('Biochemistry'); expect((await names(fut)).departments).not.toContain('Cyber Security')
    expect((await names(fut)).spots).toContain('ICT Centre'); expect((await names(fut)).spots).not.toContain('Computer Centre')
  })

  test('a student can pick a renamed spot at their own campus and not the old name', async () => {
    await openAbu()
    const abu = await makeUser('Amina', { university: 'abu' })
    await A('PATCH', `/admin/spots/${(await A('GET', '/admin/spots')).json.items.find((i: any) => i.name === 'Faculty Quad' && i.university === 'abu').id}`, { name: 'Faculty Block' })
    expect((await call(abu, 'PUT', '/me/profiles/study', { usualSpot: 'Faculty Block' })).status).toBeLessThan(300)
    expect((await call(abu, 'PUT', '/me/profiles/study', { usualSpot: 'Faculty Quad' })).status).toBeGreaterThanOrEqual(400)
  })

  test('starting empty leaves the campus with no lists until staff add them', async () => {
    expect((await openAbu({ fromTemplate: false })).status).toBe(200)
    const abu = await makeUser('Amina', { university: 'abu' })
    expect(await names(abu)).toEqual({ departments: [], spots: [], freeTimes: expect.anything() } as any)
    expect((await A('POST', '/admin/spots', { name: 'Main Library', university: 'abu' })).status).toBe(200)
    expect((await names(abu)).spots).toEqual(['Main Library'])
  })

  test('later changes to the template do not reach campuses that are already open', async () => {
    await openAbu()
    await A('POST', '/admin/departments', { name: 'Marine Biology' })                              // template only
    const abu = await makeUser('Amina', { university: 'abu' }), fut = await makeUser('Tunde')
    expect([...(await names(abu)).departments, ...(await names(fut)).departments]).not.toContain('Marine Biology')
    await A('POST', '/admin/campuses', { slug: 'unn', name: 'UNN' })                              // but a campus opened afterwards starts with it
    expect((await names(await makeUser('Ngozi', { university: 'unn' }))).departments).toContain('Marine Biology')
  })

  test('it is audited', async () => {
    await openAbu(); await A('PATCH', '/admin/campuses/abu', { name: 'ABU Zaria' }); await A('PATCH', '/admin/campuses/abu', { open: false }); await A('PATCH', '/admin/campuses/abu', { open: true })
    const actions = (await db.select().from(adminAudit)).map((r) => r.action)
    for (const a of ['campus.open', 'campus.rename', 'campus.pause', 'campus.resume']) expect(actions).toContain(a)
    expect((await A('PATCH', '/admin/campuses/nowhere', { open: false })).status).toBe(404)
  })
})

describe('staff overview and lists', () => {
  test('shows each campus with students and list sizes, and who has been asking to join (never the opened ones)', async () => {
    await makeUser('Amina'); await makeUser('Bola', { university: 'unilag' })
    await ask('a@abu.edu.ng', 1); await ask('b@abu.edu.ng', 2); await ask('c@unn.edu.ng', 3)
    const r = (await A('GET', '/admin/campuses')).json
    const fut = r.campuses.find((c: any) => c.slug === 'futminna')
    expect(fut).toMatchObject({ name: 'FUTMinna', open: true, students: 1, departments: 4, spots: 6 })
    expect(r.asked.map((a: any) => [a.slug, a.attempts])).toEqual([['abu', 2], ['unn', 1]])        // most interest first
    await openAbu()
    expect((await A('GET', '/admin/campuses')).json.asked.map((a: any) => a.slug)).toEqual(['unn']) // abu is open now, so it drops off
  })

  test('adding to the template only does not reach students; "every campus" adds one entry to each campus and the template', async () => {
    const fut = await makeUser('Amina')
    await A('POST', '/admin/spots', { name: 'Mini Stadium' })
    expect((await names(fut)).spots).not.toContain('Mini Stadium')
    const r = await A('POST', '/admin/spots', { name: 'Main Gate', everyCampus: true })
    expect(r.json.addedTo).toBe(2)                                                                 // futminna and unilag
    expect((await names(fut)).spots).toContain('Main Gate')
    expect((await db.select().from(campusSpots).where(eq(campusSpots.name, 'Main Gate'))).map((s) => s.university ?? '(template)').sort()).toEqual(['(template)', 'futminna', 'unilag'])
    expect((await A('POST', '/admin/spots', { name: 'Main Gate', everyCampus: true })).status).toBe(409)      // already in the template
  })

  test('an entry for a campus that is not open is refused', async () => {
    expect((await A('POST', '/admin/departments', { name: 'Law', university: 'nowhere' })).status).toBe(404)
  })

  test('renaming a template entry changes no student', async () => {
    const fut = await makeUser('Amina', { department: 'Cyber Security' })
    const t = (await A('GET', '/admin/departments')).json.items.find((i: any) => i.name === 'Cyber Security' && i.university === null)
    expect((await A('PATCH', `/admin/departments/${t.id}`, { name: 'Cybersecurity' })).status).toBe(200)
    expect((await db.select().from(users).where(eq(users.id, fut.id)))[0]!.department).toBe('Cyber Security')
    expect((await names(fut)).departments).toContain('Cyber Security')
  })
})
