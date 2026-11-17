import { beforeEach, describe, expect, test } from 'bun:test'
import { devOutbox } from '../src/email'
import { call, resetAll } from './helpers'

beforeEach(async () => { await resetAll(); devOutbox.length = 0 })
const code = (to: string) => devOutbox.filter((m) => m.to === to).at(-1)!.code
const ip = (n: number) => ({ 'x-forwarded-for': `10.0.0.${n}` })

describe('email verification', () => {
  test('rejects non-university addresses', async () => {
    expect((await call(null, 'POST', '/auth/request-code', { email: 'a@gmail.com' })).status).toBe(422)
    expect((await call(null, 'POST', '/auth/request-code', { email: 'a@st.futminna.edu.ng.evil.com' })).status).toBe(422)
    expect(devOutbox).toHaveLength(0)
  })

  test('full flow creates a user and a working session', async () => {
    const email = 'amina@st.futminna.edu.ng'
    expect((await call(null, 'POST', '/auth/request-code', { email })).status).toBe(200)
    const res = await call(null, 'POST', '/auth/verify', { email, code: code(email) })
    expect(res.status).toBe(200)
    expect(res.json.onboarded).toBe(false)
    expect(res.json.user.university).toBe('futminna')
    expect(JSON.stringify(res.json)).not.toContain(email) // email is never returned
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain('HttpOnly')
    const me = await call({ token: /moc_session=([^;]+)/.exec(cookie)![1]! }, 'GET', '/me')
    expect(me.status).toBe(200)
  })

  test('a code is single-use', async () => {
    const email = 'amina@st.futminna.edu.ng'
    await call(null, 'POST', '/auth/request-code', { email })
    const c = code(email)
    expect((await call(null, 'POST', '/auth/verify', { email, code: c })).status).toBe(200)
    expect((await call(null, 'POST', '/auth/verify', { email, code: c })).status).toBe(422)
  })

  test('locks the code after 5 wrong guesses, even if the right one follows', async () => {
    const email = 'amina@st.futminna.edu.ng'
    await call(null, 'POST', '/auth/request-code', { email })
    const right = code(email)
    const wrong = right === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) expect((await call(null, 'POST', '/auth/verify', { email, code: wrong })).status).toBe(422)
    expect((await call(null, 'POST', '/auth/verify', { email, code: right })).status).toBe(422)
  })

  test('protected routes need a session', async () => {
    expect((await call(null, 'GET', '/me')).status).toBe(401)
    expect((await call({ token: 'nope' }, 'GET', '/me')).status).toBe(401)
  })
})

describe('rate limits', () => {
  test('1 code per minute per address, with Retry-After', async () => {
    const email = 'amina@st.futminna.edu.ng'
    expect((await call(null, 'POST', '/auth/request-code', { email })).status).toBe(200)
    const second = await call(null, 'POST', '/auth/request-code', { email })
    expect(second.status).toBe(429)
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(devOutbox).toHaveLength(1)
  })

  test('20 codes per hour per IP', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 22; i++) statuses.push((await call(null, 'POST', '/auth/request-code', { email: `u${i}@st.futminna.edu.ng` }, ip(1))).status)
    // trustProxy is off, so the spoofed X-Forwarded-For is ignored and every call shares one address (as it should)
    expect(statuses.filter((s) => s === 200)).toHaveLength(20)
    expect(statuses.slice(20)).toEqual([429, 429])
  })

  test('verify attempts are throttled across re-requested codes', async () => {
    const email = 'amina@st.futminna.edu.ng'
    const out: number[] = []
    for (let i = 0; i < 17; i++) out.push((await call(null, 'POST', '/auth/verify', { email, code: '000000' })).status)
    expect(out.slice(0, 15).every((s) => s === 422)).toBe(true)
    expect(out.slice(15)).toEqual([429, 429])
  })
})
