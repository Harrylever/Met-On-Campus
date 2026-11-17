import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { adminAudit, departments, users } from '@moc/db'
import { db } from '../src/context'
import { adminCall, adminLogin, call, makeAdmin, makeUser, resetAll } from './helpers'

let S: string
const A = (m: string, p: string, body?: unknown) => adminCall(m, p, body, { session: S })
const NONE = 'Unspecified'
const ask = (u: { token: string }, name: string) => call(u, 'POST', '/me/department-requests', { name })
const deptOf = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!.department
const pending = async () => (await A('GET', '/admin/department-requests')).json.pending as { requestId: string; name: string; university: string; students: number }[]
const resolve = (requestId: string, body: Record<string, unknown>) => A('POST', '/admin/department-requests/resolve', { requestId, ...body })

beforeEach(async () => { await resetAll(); S = await adminLogin(await makeAdmin()) })

describe('students asking for a department', () => {
  test('needs a sign-in; creates a pending request with a tidied name; lists their own', async () => {
    expect((await call(null, 'POST', '/me/department-requests', { name: 'Marine Biology' })).status).toBe(401)
    const u = await makeUser('Amina', { department: NONE })
    const r = await ask(u, '  Marine    Biology ')
    expect(r.status).toBe(200); expect(r.json.request).toMatchObject({ name: 'Marine Biology', status: 'pending' })
    const mine = (await call(u, 'GET', '/me/department-requests')).json.requests
    expect(mine).toHaveLength(1); expect(mine[0].status).toBe('pending')
    const other = await makeUser('Tunde')
    expect((await call(other, 'GET', '/me/department-requests')).json.requests).toHaveLength(0) // never someone else's
  })

  test('rejects empty, one-character and markup-like names', async () => {
    const u = await makeUser('Amina', { department: NONE })
    for (const name of ['', ' ', 'A', '<script>x</script>', 'ab\u0000cd', 'x'.repeat(61)]) expect((await ask(u, name)).status).toBe(422)
  })

  test('a department that is already listed is not requested again; the list\'s spelling is returned', async () => {
    const u = await makeUser('Amina', { department: NONE })
    const r = await ask(u, 'cyber   security')
    expect(r.status).toBe(409); expect(r.json).toEqual({ error: 'already_listed', name: 'Cyber Security' })
  })

  test('one open request at a time; withdrawing frees the slot; nobody else can withdraw it', async () => {
    const u = await makeUser('Amina', { department: NONE }), eve = await makeUser('Eve')
    const id = (await ask(u, 'Marine Biology')).json.request.id
    expect((await ask(u, 'Statistics')).status).toBe(409)
    expect((await call(eve, 'DELETE', `/me/department-requests/${id}`)).status).toBe(404)
    expect((await call(u, 'DELETE', `/me/department-requests/${id}`)).status).toBe(200)
    expect((await call(u, 'DELETE', `/me/department-requests/${id}`)).status).toBe(404) // already withdrawn
    expect((await ask(u, 'Statistics')).status).toBe(200)
  })

  test('at most three requests a day', async () => {
    const u = await makeUser('Amina', { department: NONE })
    const codes: number[] = []
    for (const name of ['Statistics', 'Marine Biology', 'Zoology', 'Geology']) {
      const r = await ask(u, name); codes.push(r.status)
      if (r.status === 200) await call(u, 'DELETE', `/me/department-requests/${r.json.request.id}`)
    }
    expect(codes).toEqual([200, 200, 200, 429])
  })
})

describe('staff resolving requests', () => {
  test('needs a staff session', async () => {
    expect((await adminCall('GET', '/admin/department-requests')).status).toBe(401)
    expect((await adminCall('POST', '/admin/department-requests/resolve', { requestId: '00000000-0000-0000-0000-000000000000', action: 'decline' })).status).toBe(401)
  })

  test('the same name on one campus is one decision; other campuses stay separate; the nav count follows', async () => {
    const a = await makeUser('Amina', { department: NONE }), b = await makeUser('Tunde', { department: NONE }), c = await makeUser('Hauwa', { department: NONE })
    const far = await makeUser('Far', { department: NONE, university: 'unilag' }), x = await makeUser('Xavier', { department: NONE })
    await ask(a, 'Marine Biology'); await ask(b, 'marine biology'); await ask(c, 'MARINE  BIOLOGY'); await ask(far, 'Marine Biology'); await ask(x, 'Statistics')
    const groups = await pending()
    expect(groups.map((g) => `${g.university}:${g.name.toLowerCase()}:${g.students}`).sort()).toEqual(['futminna:marine biology:3', 'futminna:statistics:1', 'unilag:marine biology:1'])
    expect((await A('GET', '/admin/me')).json.departmentRequests).toBe(3)
  })

  test('approving creates the department for that campus and moves everyone who asked and still has none', async () => {
    const a = await makeUser('Amina', { department: NONE }), b = await makeUser('Tunde', { department: NONE }), c = await makeUser('Hauwa', { department: NONE })
    const far = await makeUser('Far', { department: NONE, university: 'unilag' })
    await ask(a, 'Marine Biology'); await ask(b, 'marine biology'); await ask(c, 'Marine Biology'); await ask(far, 'Marine Biology')
    await db.update(users).set({ department: 'Computer Science' }).where(eq(users.id, c.id)) // Hauwa chose another one meanwhile
    const id = (await pending()).find((g) => g.university === 'futminna')!.requestId
    const r = await resolve(id, { action: 'approve', name: 'Marine Biology' })
    expect(r.status).toBe(200); expect(r.json.students).toBe(3)
    expect(await deptOf(a.id)).toBe('Marine Biology'); expect(await deptOf(b.id)).toBe('Marine Biology')
    expect(await deptOf(c.id)).toBe('Computer Science') // keeps their own choice
    expect(await deptOf(far.id)).toBe(NONE)             // other campus untouched, still waiting
    expect((await call(a, 'GET', '/meta')).json.departments).toContain('Marine Biology')
    expect((await call(far, 'GET', '/meta')).json.departments).not.toContain('Marine Biology') // campus-only
    const mine = (await call(a, 'GET', '/me/department-requests')).json.requests[0]
    expect(mine).toMatchObject({ status: 'approved', resolvedName: 'Marine Biology' })
    expect((await pending()).map((g) => g.university)).toEqual(['unilag'])
  })

  test('approving "for all campuses" makes it global, and staff can fix the spelling', async () => {
    const a = await makeUser('Amina', { department: NONE }), far = await makeUser('Far', { university: 'unilag' })
    await ask(a, 'marine biologee')
    await resolve((await pending())[0]!.requestId, { action: 'approve', name: 'Marine Biology', scope: 'all' })
    expect(await deptOf(a.id)).toBe('Marine Biology')
    expect((await call(far, 'GET', '/meta')).json.departments).toContain('Marine Biology')
    expect((await db.select().from(departments).where(eq(departments.name, 'Marine Biology')))[0]!.university).toBeNull()
  })

  test('approving a name that already exists is refused, pointing staff to "use existing"', async () => {
    const a = await makeUser('Amina', { department: NONE })
    await ask(a, 'Cyber Securitee')
    const id = (await pending())[0]!.requestId
    const r = await resolve(id, { action: 'approve', name: 'cyber security' })
    expect(r.status).toBe(409); expect(r.json.error).toBe('already_exists')
    expect(await deptOf(a.id)).toBe(NONE); expect((await pending())).toHaveLength(1) // nothing changed
  })

  test('"use existing" maps a misspelling onto a real department, but only one that applies to that campus', async () => {
    const a = await makeUser('Amina', { department: NONE })
    await ask(a, 'Cyber Sec')
    const id = (await pending())[0]!.requestId
    const list = (await A('GET', '/admin/department-requests')).json.departments as { id: string; name: string }[]
    const [foreign] = await db.insert(departments).values({ name: 'Unilag Only Dept', university: 'unilag' }).returning()
    expect((await resolve(id, { action: 'merge', departmentId: foreign!.id })).status).toBe(422)
    expect((await resolve(id, { action: 'merge' })).status).toBe(422)
    expect((await resolve(id, { action: 'merge', departmentId: list.find((d) => d.name === 'Cyber Security')!.id })).status).toBe(200)
    expect(await deptOf(a.id)).toBe('Cyber Security')
  })

  test('declining records a reason the student can see, changes nothing else, and they can ask again', async () => {
    const a = await makeUser('Amina', { department: NONE })
    await ask(a, 'Underwater Basket Weaving')
    await resolve((await pending())[0]!.requestId, { action: 'decline', note: 'We only list departments the university offers.' })
    expect(await deptOf(a.id)).toBe(NONE)
    const mine = (await call(a, 'GET', '/me/department-requests')).json.requests[0]
    expect(mine).toMatchObject({ status: 'declined', note: 'We only list departments the university offers.' })
    expect((await ask(a, 'Zoology')).status).toBe(200) // a decision frees them to try again
  })

  test('a request can only be decided once; every decision is audited', async () => {
    const a = await makeUser('Amina', { department: NONE })
    await ask(a, 'Zoology')
    const id = (await pending())[0]!.requestId
    expect((await resolve(id, { action: 'decline' })).status).toBe(200)
    expect((await resolve(id, { action: 'approve' })).status).toBe(409)
    expect((await A('POST', '/admin/department-requests/resolve', { requestId: '00000000-0000-0000-0000-000000000000', action: 'decline' })).status).toBe(404)
    expect((await db.select().from(adminAudit)).map((r) => r.action)).toContain('department_request.decline')
    expect((await A('GET', '/admin/department-requests')).json.recent[0]).toMatchObject({ name: 'Zoology', status: 'declined', students: 1 })
  })
})

describe('students with no department yet', () => {
  test('two of them are not "the same department", so Romance hide-from-department does not hide them from each other', async () => {
    const a = await makeUser('Amina', { modes: ['romance'], department: NONE, hide: true }), b = await makeUser('Tunde', { modes: ['romance'], department: NONE })
    const cards = (await call(a, 'GET', '/discover?intent=romance')).json.cards.map((c: any) => c.name)
    expect(cards).toEqual(['Tunde'])
    // ...while two students in a real shared department are still hidden, as before
    const c = await makeUser('Hauwa', { modes: ['romance'], department: 'Cyber Security', hide: true }), d = await makeUser('Ngozi', { modes: ['romance'], department: 'Cyber Security' })
    expect((await call(c, 'GET', '/discover?intent=romance')).json.cards.map((x: any) => x.name)).not.toContain('Ngozi')
    expect(d.id).toBeTruthy(); expect(b.id).toBeTruthy()
  })
})
