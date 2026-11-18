import { Elysia, t } from 'elysia'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { pushSubscriptions } from '@moc/db'
import { authed } from '../auth'
import { db } from '../context'
import { env } from '../env'
import { allowedEndpoint, pushEnabled, pushToUser } from '../push'
import { hit } from '../ratelimit'

const MAX_DEVICES = 10
const b64url = (s: string) => /^[A-Za-z0-9_-]+$/.test(s)
const bytesOf = (s: string) => Buffer.from(s, 'base64url')

export const pushRoutes = new Elysia()
  // The public half of the key pair: browsers need it to subscribe. Not a secret.
  .get('/push/key', () => ({ enabled: pushEnabled, publicKey: pushEnabled ? env.vapidPublicKey : null }))

  .use(authed)
  // This device says yes. Sent again on every sign-in, so a shared device always belongs to whoever signed in last.
  .post('/me/push', async ({ user, body, request, status }) => {
    if (!pushEnabled) return status(503, { error: 'push_unavailable' })
    if (!allowedEndpoint(body.endpoint)) return status(422, { error: 'endpoint_not_allowed' })
    const key = bytesOf(body.keys.p256dh), auth = bytesOf(body.keys.auth)
    if (!b64url(body.keys.p256dh) || !b64url(body.keys.auth) || key.length !== 65 || key[0] !== 4 || auth.length !== 16) return status(422, { error: 'bad_keys' })
    if (await hit(`pushsub:${user.id}`, 30, 3600)) return status(429, { error: 'too_many_requests' })
    const userAgent = (request.headers.get('user-agent') ?? '').slice(0, 200) || null
    await db.insert(pushSubscriptions).values({ userId: user.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent } })
    // Keep a sensible number of devices: the oldest go first.
    const mine = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id)).orderBy(asc(pushSubscriptions.createdAt))
    if (mine.length > MAX_DEVICES) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, mine.slice(0, mine.length - MAX_DEVICES).map((m) => m.id)))
    return { ok: true }
  }, { body: t.Object({ endpoint: t.String({ maxLength: 1000 }), keys: t.Object({ p256dh: t.String({ maxLength: 200 }), auth: t.String({ maxLength: 100 }) }) }) })

  // Is this device on? (The browser knows its own endpoint; we only answer for the signed-in person's rows.)
  .post('/me/push/status', async ({ user, body }) => {
    const [row] = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, body.endpoint))).limit(1)
    return { subscribed: !!row }
  }, { body: t.Object({ endpoint: t.String({ maxLength: 1000 }) }) })

  .post('/me/push/remove', async ({ user, body }) => {
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, body.endpoint)))
    return { ok: true }
  }, { body: t.Object({ endpoint: t.String({ maxLength: 1000 }) }) })

  // "Send me a test": so turning it on can be confirmed on the spot.
  .post('/me/push/test', async ({ user, status }) => {
    if (!pushEnabled) return status(503, { error: 'push_unavailable' })
    if (await hit(`pushtest:${user.id}`, 3, 600)) return status(429, { error: 'too_many_requests' })
    const delivered = await pushToUser(user.id, { kind: 'message', body: 'Notifications are on for this device', url: '/profile' }, { force: true })
    return { delivered }
  })
