import { Elysia, t } from 'elysia'
import { authed, COOKIE_NAME } from '../auth'
import { redis } from '../context'
import { deleteAccount } from '../account'
import { safeEqual, sha256 } from '../admin/crypto'
import { sendDeletionCode } from '../email'
import { hit } from '../ratelimit'

const TTL = 600
const MAX_TRIES = 5
const codeKey = (id: string) => `delcode:${id}`
const triesKey = (id: string) => `delcode:tries:${id}`

/**
 * Deleting your own account. Irreversible, so a stolen session or a mis-tap must not be enough: the person must also
 * type DELETE and enter a fresh code emailed to their university address.
 */
export const accountRoutes = new Elysia({ prefix: '/me/delete' }).use(authed)
  .post('/code', async ({ user, status }) => {
    const wait = (await hit(`delcode:min:${user.id}`, 1, 60)) || (await hit(`delcode:hr:${user.id}`, 5, 3600))
    if (wait) return status(429, { error: 'too_many_requests', retryAfter: wait })
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0')
    await redis.multi().set(codeKey(user.id), sha256(`${user.id}:${code}`), 'EX', TTL).del(triesKey(user.id)).exec()
    try { await sendDeletionCode(user.email, code) } catch (err) {
      console.error('[account] deletion email failed', err)
      return status(502, { error: 'email_unavailable' })
    }
    return { sent: true, expiresInSeconds: TTL }
  })

  .post('/', async ({ user, body, cookie, status }) => {
    const tries = await redis.incr(triesKey(user.id))
    if (tries === 1) await redis.expire(triesKey(user.id), TTL)
    if (tries > MAX_TRIES) { await redis.del(codeKey(user.id)); return status(429, { error: 'too_many_attempts' }) }
    const stored = await redis.get(codeKey(user.id))
    if (!stored) return status(422, { error: 'code_expired' })
    if (!safeEqual(sha256(`${user.id}:${body.code}`), stored)) return status(422, { error: 'code_invalid' })
    await deleteAccount(user.id, { kind: 'self' })
    cookie[COOKIE_NAME]?.remove()
    return { ok: true }
  }, { body: t.Object({ code: t.String({ pattern: '^[0-9]{6}$' }), confirm: t.Literal('DELETE') }) })
