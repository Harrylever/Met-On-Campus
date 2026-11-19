import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createECDH, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { pushSubscriptions, users } from '@moc/db'
import { db } from '../src/context'
import { audienceCounts, broadcastPush, setPushSender, type Payload, type Sub } from '../src/push'
import * as presence from '../src/presence'
import { call, makeUser, resetAll } from './helpers'

type U = { id: string; token: string; name: string }
const FCM = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`
const keys = () => { const e = createECDH('prime256v1'); e.generateKeys(); return { p256dh: e.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }
const subscribe = (u: U, endpoint = FCM(crypto.randomUUID())) => call(u, 'POST', '/me/push', { endpoint, keys: keys() }).then(() => endpoint)
const rows = (userId: string) => db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
const MSG = { title: 'Study week', body: 'Find a study partner today', url: '/discover' }

let sent: { sub: Sub; payload: Payload }[]
let statusFor: (endpoint: string) => number
beforeEach(async () => {
  await resetAll(); sent = []; statusFor = () => 201
  setPushSender(async (sub, payload) => { sent.push({ sub, payload }); return statusFor(sub.endpoint) })
})
afterAll(() => setPushSender(null))

describe('who a broadcast reaches', () => {
  test('counts a student once and their devices separately', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await subscribe(a); await subscribe(a); await subscribe(b)
    expect(await audienceCounts({})).toEqual({ students: 2, devices: 3 })
  })

  test('students without a device are not counted', async () => {
    await makeUser('Amina'); const b = await makeUser('Tunde') as U; await subscribe(b)
    expect(await audienceCounts({})).toEqual({ students: 1, devices: 1 })
  })

  test('filters by campus and by department within a campus', async () => {
    const a = await makeUser('Amina', { university: 'futminna', department: 'Computer Science' }) as U
    const b = await makeUser('Tunde', { university: 'futminna', department: 'Physics' }) as U
    const c = await makeUser('Chidi', { university: 'unilag', department: 'Computer Science' }) as U
    for (const u of [a, b, c]) await subscribe(u)
    expect((await audienceCounts({ university: 'futminna' })).students).toBe(2)
    expect((await audienceCounts({ university: 'futminna', department: 'Computer Science' })).students).toBe(1)
    expect((await audienceCounts({ university: 'unilag', department: 'Physics' })).students).toBe(0)
  })

  test('suspended students are neither counted nor sent to', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await subscribe(a); await subscribe(b)
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, b.id))
    expect(await audienceCounts({})).toEqual({ students: 1, devices: 1 })
    expect(await broadcastPush({}, MSG)).toEqual({ students: 1, devices: 1, delivered: 1 })
    expect(sent).toHaveLength(1)
  })

  test('a device removed by its owner is no longer reached', async () => {
    const a = await makeUser('Amina') as U
    const endpoint = await subscribe(a)
    await call(a, 'POST', '/me/push/remove', { endpoint })
    expect(await broadcastPush({}, MSG)).toEqual({ students: 0, devices: 0, delivered: 0 })
    expect(sent).toHaveLength(0)
  })
})

describe('what a broadcast sends', () => {
  test("sends the staff member's title, message and link, tagged 'broadcast'", async () => {
    const a = await makeUser('Amina') as U; await subscribe(a)
    await broadcastPush({}, MSG)
    expect(sent.map((s) => s.payload)).toEqual([{ title: 'Study week', body: 'Find a study partner today', url: '/discover', tag: 'broadcast' }])
  })

  test('is not held back by the throttle or by the student being in the app', async () => {
    const a = await makeUser('Amina') as U; await subscribe(a)
    await presence.beat(a.university, a.id)
    await broadcastPush({}, MSG); await broadcastPush({}, MSG)
    expect(sent).toHaveLength(2)
  })

  test('a 410 removes that device only; a 500 is not counted as delivered but keeps the device; the rest still go out', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U, c = await makeUser('Chidi') as U
    const gone = await subscribe(a), failing = await subscribe(b), fine = await subscribe(c)
    statusFor = (e) => (e === gone ? 410 : e === failing ? 500 : 201)
    expect(await broadcastPush({}, MSG)).toEqual({ students: 3, devices: 3, delivered: 1 })
    expect(await rows(a.id)).toHaveLength(0)
    expect((await rows(b.id)).map((r) => r.endpoint)).toEqual([failing])
    expect((await rows(c.id)).map((r) => r.endpoint)).toEqual([fine])
  })
})
