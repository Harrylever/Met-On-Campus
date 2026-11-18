import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { users } from '@moc/db'
import { app } from '../src'
import { db } from '../src/context'
import { call, makeUser, resetAll } from './helpers'

beforeEach(resetAll)
const token = async (id: string) => (await db.select({ t: users.unsubscribeToken }).from(users).where(eq(users.id, id)))[0]!.t
const alertsOn = async (id: string) => (await db.select({ on: users.emailAlerts }).from(users).where(eq(users.id, id)))[0]!.on
const get = (path: string) => app.handle(new Request(`http://localhost${path}`))
const post = (path: string, body?: string, type = 'application/x-www-form-urlencoded') => app.handle(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': type }, body }))

describe('unsubscribe', () => {
  test('opening the link does nothing by itself (mail scanners open links); it shows a button', async () => {
    const u = await makeUser('Amina'); const t = await token(u.id)
    const res = await get(`/unsubscribe/${t}`)
    expect(res.status).toBe(200); expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('Turn off email alerts')
    expect(await alertsOn(u.id)).toBe(true)
  })

  test('the button, and the one-click request mail apps send, turn alerts off', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde')
    expect((await post(`/unsubscribe/${await token(a.id)}`)).status).toBe(200)
    expect(await alertsOn(a.id)).toBe(false)
    expect((await post(`/unsubscribe/${await token(b.id)}`, 'List-Unsubscribe=One-Click')).status).toBe(200)
    expect(await alertsOn(b.id)).toBe(false)
  })

  test('a token that matches nobody gets the same page, and nobody else is affected', async () => {
    const u = await makeUser('Amina')
    const stranger = await post(`/unsubscribe/${crypto.randomUUID()}`)
    expect(stranger.status).toBe(200); expect(await stranger.text()).toContain('Email alerts are off')
    expect(await alertsOn(u.id)).toBe(true)
    expect((await get('/unsubscribe/not-a-token')).status).toBe(422)
  })

  test('the page is locked down (no framing, no scripts, not cached)', async () => {
    const res = await get(`/unsubscribe/${crypto.randomUUID()}`)
    expect(res.headers.get('x-frame-options')).toBe('DENY'); expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
  })
})

describe('the setting in the app', () => {
  test('on by default, shown on /me, and the student can switch it off and on', async () => {
    const u = await makeUser('Amina')
    expect((await call(u, 'GET', '/me')).json.settings).toEqual({ emailAlerts: true })
    expect((await call(u, 'PATCH', '/me', { emailAlerts: false })).status).toBe(200)
    expect((await call(u, 'GET', '/me')).json.settings.emailAlerts).toBe(false)
    await call(u, 'PATCH', '/me', { emailAlerts: true })
    expect(await alertsOn(u.id)).toBe(true)
  })
})
