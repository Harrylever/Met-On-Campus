import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createECDH, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { adminAudit, pushBroadcasts } from '@moc/db'
import { db } from '../src/context'
import { pushIdle, setPushSender, type Payload, type Sub } from '../src/push'
import { adminCall, adminLogin, call, makeAdmin, makeUser, resetAll } from './helpers'

type U = { id: string; token: string; name: string }
const FCM = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`
const keys = () => { const e = createECDH('prime256v1'); e.generateKeys(); return { p256dh: e.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }
const subscribe = (u: U) => call(u, 'POST', '/me/push', { endpoint: FCM(crypto.randomUUID()), keys: keys() })

let S: string
let sent: { sub: Sub; payload: Payload }[]
const A = (m: string, p: string, body?: unknown) => adminCall(m, p, body, { session: S })
const send = (over: Record<string, unknown> = {}) => A('POST', '/admin/broadcasts', { title: 'Study week', body: 'Find a study partner today', ...over })

beforeEach(async () => {
  await pushIdle() // a send still running from the previous test must not leak into this one
  await resetAll(); sent = []
  setPushSender(async (sub, payload) => { sent.push({ sub, payload }); return 201 })
  S = await adminLogin(await makeAdmin())
  for (const [name, university, department] of [['Amina', 'futminna', 'Computer Science'], ['Tunde', 'futminna', 'Physics'], ['Chidi', 'unilag', 'Computer Science']] as const)
    await subscribe(await makeUser(name, { university, department }) as U)
})
afterAll(() => setPushSender(null))

describe('access', () => {
  test('needs a staff session', async () => {
    for (const [m, p, b] of [['GET', '/admin/broadcasts'], ['POST', '/admin/broadcasts/preview', {}], ['POST', '/admin/broadcasts', { title: 'a', body: 'b' }]] as const)
      expect((await adminCall(m, p, b)).status).toBe(401)
    expect(sent).toHaveLength(0)
  })
})

describe('preview', () => {
  test('counts for everyone, a campus, and a department', async () => {
    expect((await A('POST', '/admin/broadcasts/preview', {})).json).toEqual({ students: 3, devices: 3 })
    expect((await A('POST', '/admin/broadcasts/preview', { university: 'futminna' })).json).toEqual({ students: 2, devices: 2 })
    expect((await A('POST', '/admin/broadcasts/preview', { university: 'futminna', department: 'Physics' })).json).toEqual({ students: 1, devices: 1 })
  })
  test('a department without a campus is rejected', async () => {
    const r = await A('POST', '/admin/broadcasts/preview', { department: 'Physics' })
    expect(r.status).toBe(422); expect(r.json.error).toBe('department_needs_campus')
  })
})

describe('sending', () => {
  test('sends, records history, and writes an audit row', async () => {
    const r = await send({ university: 'futminna', url: '/rooms' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ students: 2, devices: 2 })
    await pushIdle()
    expect(sent.map((s) => s.payload)).toEqual(Array(2).fill({ title: 'Study week', body: 'Find a study partner today', url: '/rooms', tag: 'broadcast' }))
    const [row] = await db.select().from(pushBroadcasts)
    expect(row).toMatchObject({ title: 'Study week', url: '/rooms', university: 'futminna', department: null, students: 2, devices: 2, delivered: 2 })
    const audit = await db.select().from(adminAudit).where(eq(adminAudit.action, 'push.broadcast'))
    expect(audit).toHaveLength(1); expect(audit[0]!.targetId).toBe(row!.id)
    const list = (await A('GET', '/admin/broadcasts')).json
    expect(list.items).toHaveLength(1); expect(list.items[0]).toMatchObject({ title: 'Study week', delivered: 2, admin: 'root@platform.test' })
    expect(list.campuses.map((c: { slug: string }) => c.slug).sort()).toEqual(['futminna', 'unilag'])
    expect(list.departments.some((d: { name: string; university: string }) => d.name === 'Cyber Security' && d.university === 'futminna')).toBe(true)
  })

  test('responds before the send finishes, and the history and audit rows already exist', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    setPushSender(async (sub, payload) => { await gate; sent.push({ sub, payload }); return 201 })
    const r = await send()                      // must not wait for the push services
    expect(r.status).toBe(200); expect(r.json).toMatchObject({ students: 3, devices: 3 })
    expect(sent).toHaveLength(0)
    const [row] = await db.select().from(pushBroadcasts)
    expect(row).toMatchObject({ students: 3, devices: 3, delivered: 0 })
    expect(await db.select().from(adminAudit).where(eq(adminAudit.action, 'push.broadcast'))).toHaveLength(1)
    release(); await pushIdle()
    expect(sent).toHaveLength(3)
    expect((await db.select().from(pushBroadcasts))[0]!.delivered).toBe(3)
  })

  test('the link defaults to /discover', async () => {
    expect((await send()).status).toBe(200); await pushIdle()
    expect(sent[0]!.payload.url).toBe('/discover')
  })

  test('only in-app links are accepted', async () => {
    for (const url of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', 'discover', '/a b'])
      expect((await send({ url })).json.error, url).toBe('invalid_link')
    expect(sent).toHaveLength(0)
    expect((await send({ url: '/messages?intent=study' })).status).toBe(200)
  })

  test('title and message must be 1-50 and 1-140 characters once trimmed', async () => {
    for (const title of ['', '   ', 'x'.repeat(51)]) expect((await send({ title })).json.error, `title ${title.length}`).toBe('invalid_title')
    for (const body of ['', '   ', 'x'.repeat(141)]) expect((await send({ body })).json.error, `body ${body.length}`).toBe('invalid_body')
    expect(sent).toHaveLength(0)
    expect((await send({ title: 'x'.repeat(50), body: 'y'.repeat(140) })).status).toBe(200)
  })

  test('a department needs a campus; an unknown campus is rejected; no recipients sends nothing', async () => {
    expect((await send({ department: 'Physics' })).json.error).toBe('department_needs_campus')
    expect((await send({ university: 'nowhere' })).json.error).toBe('unknown_campus')
    const none = await send({ university: 'unilag', department: 'Physics' })
    expect(none.status).toBe(422); expect(none.json.error).toBe('no_recipients')
    expect(sent).toHaveLength(0); expect(await db.select().from(pushBroadcasts)).toHaveLength(0)
    expect((await send({ university: 'unilag', department: 'Computer Science' })).status).toBe(200) // and the no-recipients try did not block a real one
  })
})

describe('limits', () => {
  test('an identical resend is 409, and does not use up the hourly allowance', async () => {
    expect((await send()).status).toBe(200)
    const dup = await send(); expect(dup.status).toBe(409); expect(dup.json.error).toBe('duplicate_broadcast')
    for (let i = 2; i <= 5; i++) expect((await send({ title: `Study ${i}` })).status).toBe(200)
    expect(await db.select().from(pushBroadcasts)).toHaveLength(5)
  })

  test('the sixth different broadcast in an hour is 429, and the refused one can be retried later', async () => {
    for (let i = 1; i <= 5; i++) expect((await send({ title: `Study ${i}` })).status).toBe(200)
    const over = await send({ title: 'Study 6' })
    expect(over.status).toBe(429); expect(over.json.error).toBe('too_many_broadcasts')
    expect(await db.select().from(pushBroadcasts)).toHaveLength(5)
  })
})
