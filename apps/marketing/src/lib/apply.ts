import { renderApplicationEmail, validateApplication } from './volunteers'
import { site } from './site'

// Kept out of route.ts because a Next.js route file may only export HTTP handlers.

const MAX_BODY = 20_000
const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_IP = 5 // per client address, only when the address can be trusted (TRUST_PROXY=true)
const MAX_GLOBAL = 30 // across everyone: protects the Resend quota whatever the address logic does
const GLOBAL = '__all__'
const hits = new Map<string, number[]>()

export const resetRateLimit = () => hits.clear()

const recent = (key: string, now: number) => (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
const underLimit = (key: string, max: number, now: number) => recent(key, now).length < max
function record(key: string, now: number) {
  hits.set(key, [...recent(key, now), now])
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k)
}

/**
 * The client address, only when a proxy we control sits in front (TRUST_PROXY=true, same switch as the API). Such a proxy
 * appends the real address to X-Forwarded-For, so the rightmost entry is the one to use: everything to its left is
 * whatever the client chose to send. Without TRUST_PROXY the header is ignored and only the global cap applies.
 */
function clientIp(req: Request): string | null {
  if (process.env.TRUST_PROXY !== 'true') return null
  return req.headers.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean).at(-1) ?? null
}

/** Reads the body, giving up as soon as it passes MAX_BODY: a missing or false Content-Length cannot make us buffer more. */
async function readBody(req: Request): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY) { await reader.cancel().catch(() => {}); return null }
    out += decoder.decode(value, { stream: true })
  }
  return out + decoder.decode()
}

const json = (status: number, body: { ok: true } | { ok: false; error: string }) => Response.json(body, { status })
const fail = (status: number, error: string) => json(status, { ok: false, error })

export async function handleApplication(req: Request): Promise<Response> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY) return fail(413, 'That application is too large.')
  const raw = await readBody(req)
  if (raw === null) return fail(413, 'That application is too large.')

  let body: unknown
  try { body = JSON.parse(raw) } catch { return fail(400, 'Something is wrong with that form. Please try again.') }

  const result = validateApplication(body)
  if (!result.ok) return result.error === 'spam' ? json(200, { ok: true }) : fail(400, result.error)

  // Only applications that would actually be emailed count against the limits, so a student fixing typos is not locked out.
  const now = Date.now()
  const ip = clientIp(req)
  if (!underLimit(GLOBAL, MAX_GLOBAL, now) || (ip && !underLimit(ip, MAX_PER_IP, now)))
    return fail(429, `Too many applications right now. Please try again later, or email us at ${site.contactEmail}.`)
  record(GLOBAL, now)
  if (ip) record(ip, now)

  const { subject, text, html } = renderApplicationEmail(result.value)
  const key = process.env.RESEND_API_KEY
  const to = process.env.VOLUNTEER_INBOX_EMAIL
  const isProd = process.env.NODE_ENV === 'production'

  if (!key || !to) {
    if (isProd) {
      console.error('[volunteers] RESEND_API_KEY or VOLUNTEER_INBOX_EMAIL is not set')
      return fail(503, 'Applications are not available right now.')
    }
    console.log(`[volunteers:dev] ${subject}\n\n${text}`) // dev only; production never logs applicant data
    return json(200, { ok: true })
  }

  try {
    const res = await fetch(process.env.RESEND_API_URL ?? 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? 'Met On Campus <onboarding@resend.dev>',
        to: [to], reply_to: result.value.email, subject, text, html,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.error(`[volunteers] resend responded ${res.status}`) // status only: the body can echo addresses
      return fail(502, "We couldn't send your application.")
    }
  } catch {
    console.error('[volunteers] resend request failed')
    return fail(502, "We couldn't send your application.")
  }
  return json(200, { ok: true })
}
