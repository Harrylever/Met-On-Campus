import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { handleApplication, resetRateLimit } from '../src/lib/apply'

const valid = {
  name: 'Ada Obi', email: 'ada@st.futminna.edu.ng', department: 'Computer Science', level: '300', role: 'video-creator',
  experience: 'I edit short videos.', why: 'I like telling stories.', extra: '', website: '',
}

// The proxy appends the real client address to X-Forwarded-For, so the rightmost entry is the trustworthy one.
const req = (body: unknown, ip = '1.2.3.4', raw?: string, forged = '10.0.0.1') =>
  new Request('http://localhost/volunteers/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `${forged}, ${ip}` },
    body: raw ?? JSON.stringify(body),
  })

type Call = { url: string; init: RequestInit }
let calls: Call[] = []
let resendStatus = 200
const realFetch = globalThis.fetch
const envKeys = ['RESEND_API_KEY', 'VOLUNTEER_INBOX_EMAIL', 'EMAIL_FROM', 'NODE_ENV', 'TRUST_PROXY'] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  resetRateLimit()
  calls = []
  resendStatus = 200
  for (const k of envKeys) savedEnv[k] = process.env[k]
  process.env.RESEND_API_KEY = 're_test'
  process.env.VOLUNTEER_INBOX_EMAIL = 'owner@example.com'
  process.env.EMAIL_FROM = 'Met On Campus <noreply@example.com>'
  process.env.TRUST_PROXY = 'true'
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response('{}', { status: resendStatus })
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  for (const k of envKeys) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k] }
})

describe('handleApplication', () => {
  test('a valid application is emailed to the inbox with reply_to set to the applicant', async () => {
    const res = await handleApplication(req(valid))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.resend.com/emails')
    const sent = JSON.parse(calls[0]!.init.body as string)
    expect(sent.to).toEqual(['owner@example.com'])
    expect(sent.from).toBe('Met On Campus <noreply@example.com>')
    expect(sent.reply_to).toBe('ada@st.futminna.edu.ng')
    expect(sent.subject).toBe('Volunteer application: Video Content Creator - Ada Obi')
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer re_test')
  })

  test('an invalid role returns 400 and sends nothing', async () => {
    const res = await handleApplication(req({ ...valid, role: 'developer' }))
    expect(res.status).toBe(400)
    expect((await res.json()).ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('a non-FUTMinna email returns 400 with a friendly message', async () => {
    const res = await handleApplication(req({ ...valid, email: 'ada@gmail.com' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('FUTMinna')
    expect(calls).toHaveLength(0)
  })

  test('a filled honeypot pretends success and sends nothing', async () => {
    const res = await handleApplication(req({ ...valid, website: 'http://spam' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(calls).toHaveLength(0)
  })

  test('malformed JSON returns 400', async () => {
    const res = await handleApplication(req(null, '1.2.3.4', '{not json'))
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test('a body over 20 KB returns 413 and sends nothing', async () => {
    const res = await handleApplication(req({ ...valid, extra: 'x'.repeat(25_000) }))
    expect(res.status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  test('the sixth request from one IP in an hour returns 429; another IP is unaffected', async () => {
    for (let i = 0; i < 5; i++) expect((await handleApplication(req(valid, '9.9.9.9'))).status).toBe(200)
    expect((await handleApplication(req(valid, '9.9.9.9'))).status).toBe(429)
    expect((await handleApplication(req(valid, '8.8.8.8'))).status).toBe(200)
  })

  test('a Resend failure returns 502', async () => {
    resendStatus = 500
    const res = await handleApplication(req(valid))
    expect(res.status).toBe(502)
    expect((await res.json()).ok).toBe(false)
  })

  test('in production, missing Resend config returns 503 and never succeeds silently', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.RESEND_API_KEY
    const res = await handleApplication(req(valid))
    expect(res.status).toBe(503)
    expect(calls).toHaveLength(0)
  })

  test('in development, missing Resend config logs and returns ok', async () => {
    delete process.env.RESEND_API_KEY
    const res = await handleApplication(req(valid))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(0)
  })

  test('failed validation does not use up the per-IP allowance', async () => {
    for (let i = 0; i < 8; i++) expect((await handleApplication(req({ ...valid, email: 'a@gmail.com' }, '7.7.7.7'))).status).toBe(400)
    expect((await handleApplication(req(valid, '7.7.7.7'))).status).toBe(200)
  })

  test('the 429 message points to the contact email as a fallback', async () => {
    for (let i = 0; i < 5; i++) await handleApplication(req(valid, '6.6.6.6'))
    const res = await handleApplication(req(valid, '6.6.6.6'))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toContain('email us at')
  })

  test('with TRUST_PROXY on, a forged leftmost X-Forwarded-For entry does not give a fresh allowance', async () => {
    for (let i = 0; i < 5; i++) expect((await handleApplication(req(valid, '5.5.5.5', undefined, `forged-${i}`))).status).toBe(200)
    expect((await handleApplication(req(valid, '5.5.5.5', undefined, 'forged-new'))).status).toBe(429)
  })

  test('without TRUST_PROXY, X-Forwarded-For is ignored: no per-IP lockout, but a global cap of 30 an hour protects the email quota', async () => {
    delete process.env.TRUST_PROXY
    for (let i = 0; i < 30; i++) expect((await handleApplication(req(valid, `10.1.1.${i}`))).status).toBe(200)
    expect((await handleApplication(req(valid, '10.2.2.2'))).status).toBe(429)
  })

  test('a chunked body with no content-length is cut off at 20 KB with 413', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(5_000))
    let sent = 0
    const body = new ReadableStream({ pull(c) { if (sent++ < 100) c.enqueue(chunk); else c.close() } })
    const r = new Request('http://localhost/volunteers/apply', { method: 'POST', body, duplex: 'half', headers: { 'x-forwarded-for': '4.4.4.4' } } as RequestInit)
    const res = await handleApplication(r)
    expect(res.status).toBe(413)
    expect(sent).toBeLessThan(20)
    expect(calls).toHaveLength(0)
  })
})
