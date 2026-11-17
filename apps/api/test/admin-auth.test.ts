import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from '../src/context'
import { adminAudit, adminSessions, adminUsers } from '@moc/db'
import { eq } from 'drizzle-orm'
import { adminCall, adminLogin, currentCode, makeAdmin, resetAll, PASSWORD } from './helpers'

beforeEach(resetAll)

describe('service gate', () => {
  test('every /admin route is a 404 without the platform secret, before validation or auth', async () => {
    for (const [m, p] of [['GET', '/admin/overview'], ['POST', '/admin/auth/login'], ['GET', '/admin/me'], ['GET', '/admin/users/xyz']] as const) {
      expect((await adminCall(m, p, undefined, { token: null })).status).toBe(404)
      expect((await adminCall(m, p, undefined, { token: 'wrong-token-wrong-token-wrong-token-wrong' })).status).toBe(404)
    }
  })
  test('the secret alone is not enough: data routes need a staff session', async () => {
    expect((await adminCall('GET', '/admin/overview')).status).toBe(401)
    expect((await adminCall('GET', '/admin/overview', undefined, { session: 'made-up-session' })).status).toBe(401)
  })
  test('student sessions do not open admin routes', async () => {
    const res = await adminCall('GET', '/admin/overview', undefined, { session: 'tok-student' })
    expect(res.status).toBe(401)
  })
})

describe('login', () => {
  test('wrong password and unknown email give the same answer', async () => {
    const a = await makeAdmin()
    const wrong = await adminCall('POST', '/admin/auth/login', { email: a.email, password: 'nope-nope-nope-nope' })
    const unknown = await adminCall('POST', '/admin/auth/login', { email: 'ghost@platform.test', password: 'nope-nope-nope-nope' })
    expect(wrong.status).toBe(401); expect(unknown.status).toBe(401)
    expect(wrong.json).toEqual(unknown.json)
  })

  test('password alone never yields a session; MFA does', async () => {
    const a = await makeAdmin()
    const l = await adminCall('POST', '/admin/auth/login', { email: a.email, password: a.password })
    expect(l.status).toBe(200)
    expect(l.json.sessionToken).toBeUndefined()
    expect((await adminCall('GET', '/admin/me', undefined, { session: l.json.challenge })).status).toBe(401)
    const m = await adminCall('POST', '/admin/auth/mfa', { challenge: l.json.challenge, code: currentCode(a.secret) })
    expect(m.status).toBe(200)
    expect((await adminCall('GET', '/admin/me', undefined, { session: m.json.sessionToken })).json.email).toBe(a.email)
  })

  test('a TOTP code works once (replay protection)', async () => {
    const a = await makeAdmin()
    const code = currentCode(a.secret)
    const l1 = await adminCall('POST', '/admin/auth/login', { email: a.email, password: a.password })
    expect((await adminCall('POST', '/admin/auth/mfa', { challenge: l1.json.challenge, code })).status).toBe(200)
    const l2 = await adminCall('POST', '/admin/auth/login', { email: a.email, password: a.password })
    expect((await adminCall('POST', '/admin/auth/mfa', { challenge: l2.json.challenge, code })).status).toBe(401)
  })

  test('a challenge allows 5 guesses, then dies even for the right code', async () => {
    const a = await makeAdmin()
    const l = await adminCall('POST', '/admin/auth/login', { email: a.email, password: a.password })
    const wrong = currentCode(a.secret) === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) await adminCall('POST', '/admin/auth/mfa', { challenge: l.json.challenge, code: wrong })
    expect((await adminCall('POST', '/admin/auth/mfa', { challenge: l.json.challenge, code: currentCode(a.secret) })).status).toBe(401)
  })

  test('5 failed passwords lock the account, even for the right password', async () => {
    const a = await makeAdmin()
    for (let i = 0; i < 5; i++) await adminCall('POST', '/admin/auth/login', { email: a.email, password: `wrong-password-${i}` })
    expect((await adminCall('POST', '/admin/auth/login', { email: a.email, password: PASSWORD })).status).toBe(401)
  })

  test('backup codes are single-use', async () => {
    const a = await makeAdmin()
    const use = async (code: string) => {
      const l = await adminCall('POST', '/admin/auth/login', { email: a.email, password: a.password })
      return adminCall('POST', '/admin/auth/mfa', { challenge: l.json.challenge, backupCode: code })
    }
    const first = await use(a.backupCodes[0]!)
    expect(first.status).toBe(200)
    expect(first.json.usedBackup).toBe(true)
    expect(first.json.backupCodesLeft).toBe(9)
    expect((await use(a.backupCodes[0]!)).status).toBe(401)
    expect((await use(a.backupCodes[1]!.toUpperCase().replace(/-/g, ' '))).status).toBe(200) // forgiving about formatting
  })

  test('only allowlisted, enabled accounts can sign in', async () => {
    const notListed = await makeAdmin('stranger@platform.test')
    expect((await adminCall('POST', '/admin/auth/login', { email: notListed.email, password: notListed.password })).status).toBe(401)
    const disabled = await makeAdmin('second@platform.test')
    await db.update(adminUsers).set({ disabledAt: new Date() }).where(eq(adminUsers.id, disabled.id))
    expect((await adminCall('POST', '/admin/auth/login', { email: disabled.email, password: disabled.password })).status).toBe(401)
  })

  test('rate limits login attempts per address', async () => {
    const out: number[] = []
    for (let i = 0; i < 12; i++) out.push((await adminCall('POST', '/admin/auth/login', { email: 'ghost@platform.test', password: 'x'.repeat(12) })).status)
    expect(out.slice(10)).toEqual([429, 429])
  })
})

describe('sessions', () => {
  test('idle sessions expire; absolute lifetime is enforced', async () => {
    const a = await makeAdmin()
    const s1 = await adminLogin(a)
    await db.update(adminSessions).set({ lastSeenAt: new Date(Date.now() - 31 * 60_000) })
    expect((await adminCall('GET', '/admin/me', undefined, { session: s1 })).status).toBe(401)
    const s2 = await adminLogin(a, '198.51.100.7')
    await db.update(adminSessions).set({ expiresAt: new Date(Date.now() - 1000) })
    expect((await adminCall('GET', '/admin/me', undefined, { session: s2 })).status).toBe(401)
  })

  test('logout ends the session; disabling an admin ends every session at once', async () => {
    const a = await makeAdmin()
    const s = await adminLogin(a)
    expect((await adminCall('POST', '/admin/auth/logout', undefined, { session: s })).status).toBe(200)
    expect((await adminCall('GET', '/admin/me', undefined, { session: s })).status).toBe(401)
    const s2 = await adminLogin(a, '198.51.100.8')
    await db.update(adminUsers).set({ disabledAt: new Date() }).where(eq(adminUsers.id, a.id))
    expect((await adminCall('GET', '/admin/me', undefined, { session: s2 })).status).toBe(401)
  })

  test('removing an address from the allowlist cuts off live sessions too', async () => {
    const a = await makeAdmin('second@platform.test')
    const s = await adminLogin(a)
    await db.update(adminUsers).set({ email: 'removed@platform.test' }).where(eq(adminUsers.id, a.id))
    expect((await adminCall('GET', '/admin/me', undefined, { session: s })).status).toBe(401)
  })

  test('secrets are never stored in plain text', async () => {
    const a = await makeAdmin()
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, a.id))
    expect(row!.passwordHash).toStartWith('$argon2id$')
    expect(row!.totpSecretEnc).not.toContain(a.secret)
    for (const code of a.backupCodes) expect(row!.backupCodeHashes).not.toContain(code)
    const s = await adminLogin(a)
    const [sess] = await db.select().from(adminSessions)
    expect(sess!.tokenHash).not.toBe(s)
  })

  test('logins and failures are written to the audit log', async () => {
    const a = await makeAdmin()
    await adminCall('POST', '/admin/auth/login', { email: a.email, password: 'wrong-wrong-wrong' })
    await adminLogin(a, '198.51.100.9')
    const actions = (await db.select().from(adminAudit)).map((r) => r.action)
    expect(actions).toContain('login.password_failed')
    expect(actions).toContain('login.success')
  })
})

describe('first-time setup', () => {
  async function invited(email = 'root@platform.test') {
    const token = 'invite-token-' + crypto.randomUUID()
    const hash = new Bun.CryptoHasher('sha256').update(token).digest('hex')
    await db.insert(adminUsers).values({ email, setupTokenHash: hash, setupExpiresAt: new Date(Date.now() + 3600_000) })
    return token
  }

  test('invite -> password -> authenticator -> backup codes -> can sign in; link is then dead', async () => {
    const token = await invited()
    expect((await adminCall('POST', '/admin/auth/setup/check', { token })).json.email).toBe('root@platform.test')
    const weak = await adminCall('POST', '/admin/auth/setup/begin', { token, password: 'short' })
    expect(weak.status).toBe(422)
    const begin = await adminCall('POST', '/admin/auth/setup/begin', { token, password: PASSWORD })
    expect(begin.status).toBe(200)
    expect(begin.json.otpauthUri).toStartWith('otpauth://totp/')
    expect((await adminCall('POST', '/admin/auth/setup/confirm', { token, code: '000000' })).status).toBe(422)
    const done = await adminCall('POST', '/admin/auth/setup/confirm', { token, code: currentCode(begin.json.secret) })
    expect(done.status).toBe(200)
    expect(done.json.backupCodes).toHaveLength(10)
    expect((await adminCall('POST', '/admin/auth/setup/check', { token })).status).toBe(404) // single use
    expect(await adminLogin({ email: 'root@platform.test', password: PASSWORD, secret: begin.json.secret })).toBeTruthy()
  })

  test('cannot log in until MFA enrolment is confirmed', async () => {
    const token = await invited()
    await adminCall('POST', '/admin/auth/setup/begin', { token, password: PASSWORD })
    expect((await adminCall('POST', '/admin/auth/login', { email: 'root@platform.test', password: PASSWORD })).status).toBe(401)
  })

  test('expired or unknown invites are rejected; non-allowlisted invites are dead', async () => {
    expect((await adminCall('POST', '/admin/auth/setup/check', { token: 'nope' })).status).toBe(404)
    const token = await invited('stranger@platform.test')
    expect((await adminCall('POST', '/admin/auth/setup/check', { token })).status).toBe(404)
    const t2 = await invited('second@platform.test')
    await db.update(adminUsers).set({ setupExpiresAt: new Date(Date.now() - 1000) }).where(eq(adminUsers.email, 'second@platform.test'))
    expect((await adminCall('POST', '/admin/auth/setup/check', { token: t2 })).status).toBe(404)
  })
})
