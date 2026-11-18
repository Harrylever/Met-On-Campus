import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createECDH, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { pushSubscriptions, users } from '@moc/db'
import { bus, db, topics } from '../src/context'
import { env } from '../src/env'
import { pushIdle, setPushSender, type Payload, type Sub } from '../src/push'
import * as presence from '../src/presence'
import { call, makeUser, resetAll } from './helpers'

type U = { id: string; token: string; name: string }
const FCM = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`
/** A device's real-looking keys: a P-256 public key (65 bytes) and a 16-byte auth secret. */
const keys = () => { const e = createECDH('prime256v1'); e.generateKeys(); return { p256dh: e.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }
const subscribe = (u: U, endpoint = FCM(crypto.randomUUID()), k = keys()) => call(u, 'POST', '/me/push', { endpoint, keys: k }).then((r) => ({ r, endpoint }))
const rows = (userId: string) => db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))

let sent: { sub: Sub; payload: Payload }[]
let status = 201
beforeEach(async () => {
  await resetAll(); sent = []; status = 201
  setPushSender(async (sub, payload) => { sent.push({ sub, payload }); return status })
})
afterAll(() => setPushSender(null))

describe('turning it on', () => {
  test('the public key is available to anyone, the rest needs a sign-in', async () => {
    const k = await call(null, 'GET', '/push/key')
    expect(k.json).toEqual({ enabled: true, publicKey: env.vapidPublicKey })
    expect((await call(null, 'POST', '/me/push', { endpoint: FCM('a'), keys: keys() })).status).toBe(401)
    expect((await call(null, 'POST', '/me/push/test')).status).toBe(401)
  })

  test('only the real browser push services are accepted (no internal addresses, no look-alikes)', async () => {
    const u = await makeUser('Amina') as U
    const bad = ['http://fcm.googleapis.com/fcm/send/x', 'https://evil.example.com/push', 'https://169.254.169.254/latest/meta-data', 'https://localhost/x',
      'https://fcm.googleapis.com.evil.com/x', 'https://evilfcm.googleapis.com/x', 'https://evilfcm.googleapis.com.attacker.io/x', 'https://fcm.googleapis.com:8443/x', 'https://user:pw@fcm.googleapis.com/x', 'ftp://fcm.googleapis.com/x', 'not a url']
    for (const endpoint of bad) expect((await call(u, 'POST', '/me/push', { endpoint, keys: keys() })).json.error ?? 'x').toMatch(/endpoint_not_allowed|validation|x/)
    for (const endpoint of bad) expect((await call(u, 'POST', '/me/push', { endpoint, keys: keys() })).status).not.toBe(200)
    expect(await rows(u.id)).toHaveLength(0)
    for (const endpoint of [FCM('a'), 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/QGx', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://eu-west-1.push.apple.com/x'])
      expect((await call(u, 'POST', '/me/push', { endpoint, keys: keys() })).status).toBe(200)
  })

  test('the device keys must really be keys', async () => {
    const u = await makeUser('Amina') as U
    const good = keys()
    for (const k of [{ ...good, p256dh: 'short' }, { ...good, auth: 'short' }, { ...good, p256dh: Buffer.alloc(65, 1).toString('base64url') } /* not a point marker 0x04 */, { p256dh: '***', auth: '***' }])
      expect((await call(u, 'POST', '/me/push', { endpoint: FCM('k'), keys: k })).status).toBe(422)
    expect(await rows(u.id)).toHaveLength(0)
  })

  test('status and remove answer only for the signed-in person; subscribing again does not duplicate', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    const { endpoint } = await subscribe(a); await call(a, 'POST', '/me/push', { endpoint, keys: keys() })
    expect(await rows(a.id)).toHaveLength(1)
    expect((await call(a, 'POST', '/me/push/status', { endpoint })).json.subscribed).toBe(true)
    expect((await call(b, 'POST', '/me/push/status', { endpoint })).json.subscribed).toBe(false)   // not their device
    await call(b, 'POST', '/me/push/remove', { endpoint }); expect(await rows(a.id)).toHaveLength(1) // and cannot remove it
    await call(a, 'POST', '/me/push/remove', { endpoint }); expect(await rows(a.id)).toHaveLength(0)
  })

  test('a shared device belongs to whoever signed in last, so the old account stops getting its notifications', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    const { endpoint } = await subscribe(a)
    await subscribe(b, endpoint)
    expect(await rows(a.id)).toHaveLength(0); expect(await rows(b.id)).toHaveLength(1)
    bus.publish(topics.user(a.id), { type: 'message.new', intent: 'study', message: { senderId: b.id } }); await pushIdle()
    expect(sent).toHaveLength(0)
  })

  test('at most ten devices a person: the oldest are dropped', async () => {
    const u = await makeUser('Amina') as U
    const first = await subscribe(u)
    for (let i = 0; i < 10; i++) await subscribe(u)
    const mine = await rows(u.id)
    expect(mine).toHaveLength(10); expect(mine.some((m) => m.endpoint === first.endpoint)).toBe(false)
  })

  test('deleting the account removes the devices', async () => {
    const u = await makeUser('Amina') as U; await subscribe(u)
    await db.delete(users).where(eq(users.id, u.id))
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0)
  })
})

describe('what is sent, and when', () => {
  test('a new invite, message and room events become notifications, in generic words', async () => {
    const u = await makeUser('Amina') as U, other = await makeUser('Tunde') as U
    await subscribe(u)
    const events: Record<string, unknown>[] = [
      { type: 'connection.new', intent: 'romance', from: { id: other.id, name: 'Tunde' } },
      { type: 'message.new', intent: 'romance', message: { senderId: other.id, body: 'secret text' } },
      { type: 'room.request', roomId: 'r', from: { name: 'Tunde' } },
    ]
    for (const e of events) { bus.publish(topics.user(u.id), e); await pushIdle() }
    expect(sent.map((s) => s.payload.body)).toEqual(['You have a new invite', 'You have a new message', 'Someone asked to join your room'])
    for (const { payload } of sent) {
      expect(`${payload.title} ${payload.body}`).not.toMatch(/tunde|amina|secret|romance|spark|friends|study/i)
      expect(payload.title).toBe('Met On Campus')
    }
    expect(sent[0]!.payload.url).toBe(`/messages?intent=romance&with=${other.id}`)   // where it opens, never shown on the lock screen
  })

  test('nothing for events that are not news to the person (presence, a "not now", staff decisions)', async () => {
    const u = await makeUser('Amina') as U; await subscribe(u)
    for (const e of [{ type: 'presence.count', count: 3 }, { type: 'connection.updated', status: 'declined' }, { type: 'photo.review', status: 'rejected' },
      { type: 'department.request', status: 'declined' }, { type: 'connection.removed' }, { type: 'account.deleted' }]) { bus.publish(topics.user(u.id), e); await pushIdle() }
    expect(sent).toHaveLength(0)
    bus.publish(topics.user(u.id), { type: 'connection.updated', status: 'accepted' }); await pushIdle()
    expect(sent.map((s) => s.payload.body)).toEqual(['Your invite was accepted'])
  })

  test('the real flows push: inviting someone notifies them, and not the person who invited', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await subscribe(a); const { endpoint } = await subscribe(b)
    expect((await call(a, 'POST', '/connections', { toUserId: b.id, intent: 'study' })).status).toBe(200); await pushIdle()
    expect(sent).toHaveLength(1); expect(sent[0]!.sub.endpoint).toBe(endpoint); expect(sent[0]!.payload.body).toBe('You have a new invite')
  })

  test('ten messages in a minute are one notification; different kinds are separate', async () => {
    const u = await makeUser('Amina') as U, o = await makeUser('Tunde') as U; await subscribe(u)
    for (let i = 0; i < 10; i++) { bus.publish(topics.user(u.id), { type: 'message.new', intent: 'study', message: { senderId: o.id } }); await pushIdle() }
    expect(sent).toHaveLength(1)
    bus.publish(topics.user(u.id), { type: 'connection.new', intent: 'study', from: { id: o.id } }); await pushIdle()
    expect(sent.map((s) => s.payload.tag)).toEqual(['message', 'invite'])
  })

  test('not while they are in the app (they see it live), and not to suspended accounts', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U, o = await makeUser('Chidi') as U
    await subscribe(a); await subscribe(b)
    await presence.beat('futminna', a.id)
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, b.id))
    for (const id of [a.id, b.id]) { bus.publish(topics.user(id), { type: 'message.new', intent: 'study', message: { senderId: o.id } }); await pushIdle() }
    expect(sent).toHaveLength(0)
  })

  test('every device of a person is notified, and one failing device does not stop the others', async () => {
    const u = await makeUser('Amina') as U, o = await makeUser('Tunde') as U
    const d1 = await subscribe(u), d2 = await subscribe(u), d3 = await subscribe(u)
    setPushSender(async (sub, payload) => { if (sub.endpoint === d2.endpoint) throw new Error('network'); sent.push({ sub, payload }); return 201 })
    bus.publish(topics.user(u.id), { type: 'message.new', intent: 'study', message: { senderId: o.id } }); await pushIdle()
    expect(sent.map((s) => s.sub.endpoint).sort()).toEqual([d1.endpoint, d3.endpoint].sort())
    expect(await rows(u.id)).toHaveLength(3)   // a hiccup is not a reason to forget a device
  })

  test('a device the push service says is gone (404 or 410) is forgotten; other errors keep it', async () => {
    const u = await makeUser('Amina') as U, o = await makeUser('Tunde') as U
    const gone = await subscribe(u), flaky = await subscribe(u), fine = await subscribe(u)
    setPushSender(async (sub) => (sub.endpoint === gone.endpoint ? 410 : sub.endpoint === flaky.endpoint ? 503 : 201))
    bus.publish(topics.user(u.id), { type: 'message.new', intent: 'study', message: { senderId: o.id } }); await pushIdle()
    expect((await rows(u.id)).map((r) => r.endpoint).sort()).toEqual([flaky.endpoint, fine.endpoint].sort())
  })

  test('"send me a test" reaches the devices even when online and repeated, but only a few times', async () => {
    const u = await makeUser('Amina') as U; await subscribe(u); await presence.beat('futminna', u.id)
    for (let i = 0; i < 3; i++) { const r = await call(u, 'POST', '/me/push/test'); expect(r.json.delivered).toBe(1) }
    expect((await call(u, 'POST', '/me/push/test')).status).toBe(429)
    expect(sent.every((s) => s.payload.body === 'Notifications are on for this device')).toBe(true)
  })
})

describe('the real sender', () => {
  test('encrypts and signs the request correctly, and forgets a device that has gone', async () => {
    setPushSender(null)                                              // the real thing, talking to a local mock push service
    const u = await makeUser('Amina') as U, o = await makeUser('Tunde') as U
    const seen: { headers: Record<string, string | null>; bytes: number; path: string }[] = []
    let answer = 201
    const srv = Bun.serve({ port: 9912, async fetch(req) {
      const h = (n: string) => req.headers.get(n)
      seen.push({ path: new URL(req.url).pathname, headers: { auth: h('authorization'), enc: h('content-encoding'), ttl: h('ttl'), topic: h('topic'), urgency: h('urgency') }, bytes: (await req.arrayBuffer()).byteLength })
      return new Response(null, { status: answer })
    } })
    try {
      const endpoint = 'http://localhost:9912/push/device-1'; await subscribe(u, endpoint)
      bus.publish(topics.user(u.id), { type: 'message.new', intent: 'study', message: { senderId: o.id } }); await pushIdle()
      expect(seen).toHaveLength(1)
      expect(seen[0]!.path).toBe('/push/device-1')
      expect(seen[0]!.headers.auth).toMatch(/^vapid t=.+, k=/)         // signed with our VAPID key
      expect(seen[0]!.headers.enc).toBe('aes128gcm')                   // payload is encrypted for that device
      expect(seen[0]!.headers.ttl).toBe('3600'); expect(seen[0]!.headers.topic).toBe('message')
      expect(seen[0]!.bytes).toBeGreaterThan(100)
      expect((await rows(u.id))[0]!.lastSentAt).not.toBeNull()
      answer = 410
      await db.delete(await import('@moc/db').then((m) => m.pushSubscriptions)) // fresh device, then it goes away at the service
      await subscribe(u, endpoint)
      await (await import('../src/context')).redis.flushdb()          // clear the throttle for a second notification
      bus.publish(topics.user(u.id), { type: 'message.new', intent: 'study', message: { senderId: o.id } }); await pushIdle()
      expect(await rows(u.id)).toHaveLength(0)
    } finally { srv.stop(true) }
  })
})
