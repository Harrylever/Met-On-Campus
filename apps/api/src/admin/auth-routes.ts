import { Elysia, t } from 'elysia'
import { and, eq, sql } from 'drizzle-orm'
import { adminSessions, adminUsers, reports } from '@moc/db'
import { db, redis } from '../context'
import { hit } from '../ratelimit'
import { decrypt, encrypt, hashBackupCode, newBackupCodes, randomToken, sha256 } from './crypto'
import { newTotpSecret, otpauthUri, verifyTotp } from './totp'
import { ADMIN_SESSION_HOURS, adminAuthed, adminEmailAllowed, audit, callerIp } from './session'

const MAX_FAILS = 5
const LOCK_MINUTES = 15
const CHALLENGE_TTL = 300
// A real argon2id hash of a random string, so unknown emails cost the same time as wrong passwords.
const DUMMY_HASH = await Bun.password.hash(randomToken(), { algorithm: 'argon2id' })

export function passwordProblem(pw: string, email: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.'
  if (pw.length > 128) return 'Use at most 128 characters.'
  if (pw.toLowerCase().includes(email.split('@')[0]!.toLowerCase())) return 'Do not include your email name in the password.'
  if (new Set(pw).size < 6) return 'Use a more varied password.'
  return null
}

/** Count a failed credential/MFA attempt; lock the account after MAX_FAILS. */
async function registerFailure(adminId: string) {
  const [row] = await db.update(adminUsers).set({ failedLogins: sql`${adminUsers.failedLogins} + 1` }).where(eq(adminUsers.id, adminId)).returning()
  if (row && row.failedLogins >= MAX_FAILS) {
    await db.update(adminUsers).set({ lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000), failedLogins: 0 }).where(eq(adminUsers.id, adminId))
  }
}

async function issueSession(adminId: string, ip: string, userAgent: string) {
  const token = randomToken(32)
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_HOURS * 3600_000)
  await db.insert(adminSessions).values({ tokenHash: sha256(token), adminId, ip, userAgent: userAgent.slice(0, 200), expiresAt })
  await db.update(adminUsers).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(adminUsers.id, adminId))
  return { token, expiresAt }
}

const tooMany = (set: { headers: Record<string, string | number | undefined> }, wait: number) => {
  set.headers['retry-after'] = String(wait)
  return { error: 'too_many_requests', retryAfter: wait }
}

export const adminAuthRoutes = new Elysia({ prefix: '/admin/auth' })
  // ---- Step 1: email + password -> short-lived MFA challenge ------------------------------------
  .post('/login', async ({ body, request, set, status }) => {
    const email = body.email.trim().toLowerCase()
    const ip = callerIp(request)
    const wait = (await hit(`admin:login:email:${email}`, 10, 900)) || (await hit(`admin:login:ip:${ip}`, 30, 900))
    if (wait) { set.status = 429; return tooMany(set, wait) }

    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1)
    const eligible = !!admin && !!admin.passwordHash && !!admin.totpEnabledAt && !admin.disabledAt && adminEmailAllowed(email)
    const locked = !!admin?.lockedUntil && admin.lockedUntil > new Date()
    // Always verify something so response time does not reveal whether the account exists.
    const ok = await Bun.password.verify(body.password, eligible ? admin!.passwordHash! : DUMMY_HASH).catch(() => false)
    if (!eligible || locked || !ok) {
      if (admin && eligible && !locked && !ok) await registerFailure(admin.id)
      await audit(admin?.id ?? null, 'login.password_failed', { meta: { email, locked }, ip })
      return status(401, { error: 'invalid_credentials' })
    }
    const challenge = randomToken(24)
    await redis.set(`admin:chal:${sha256(challenge)}`, admin!.id, 'EX', CHALLENGE_TTL)
    return { challenge, expiresIn: CHALLENGE_TTL }
  }, { body: t.Object({ email: t.String({ maxLength: 254 }), password: t.String({ minLength: 1, maxLength: 256 }) }) })

  // ---- Step 2: authenticator code or backup code -> session ----------------------------------------
  .post('/mfa', async ({ body, request, set, status }) => {
    const ip = callerIp(request)
    const key = `admin:chal:${sha256(body.challenge)}`
    const wait = await hit(`admin:mfa:ip:${ip}`, 30, 900)
    if (wait) { set.status = 429; return tooMany(set, wait) }
    // A challenge allows 5 guesses in total, then it is destroyed and the password step must be repeated.
    if ((await redis.incr(`${key}:tries`)) > 5) { await redis.del(key, `${key}:tries`); return status(401, { error: 'invalid_code' }) }
    const adminId = await redis.get(key)
    if (!adminId) return status(401, { error: 'invalid_code' })
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.id, adminId)).limit(1)
    if (!admin || admin.disabledAt || !adminEmailAllowed(admin.email) || !admin.totpSecretEnc) return status(401, { error: 'invalid_code' })
    if (admin.lockedUntil && admin.lockedUntil > new Date()) return status(401, { error: 'invalid_code' })

    let ok = false
    let usedBackup = false
    if (body.code) {
      const step = verifyTotp(decrypt(admin.totpSecretEnc), body.code.trim())
      // Each 30s code is single-use, so a shoulder-surfed or intercepted code cannot be replayed.
      if (step !== null) ok = (await redis.set(`admin:totp:used:${admin.id}:${step}`, '1', 'EX', 120, 'NX')) === 'OK'
    } else if (body.backupCode) {
      const h = hashBackupCode(body.backupCode)
      // Atomic: the hash is removed in the same statement that checks it, so a code can only work once.
      const [row] = await db.update(adminUsers).set({ backupCodeHashes: sql`array_remove(${adminUsers.backupCodeHashes}, ${h})` })
        .where(and(eq(adminUsers.id, admin.id), sql`${h} = ANY(${adminUsers.backupCodeHashes})`)).returning({ left: adminUsers.backupCodeHashes })
      ok = !!row; usedBackup = ok
    }
    if (!ok) {
      await registerFailure(admin.id)
      await audit(admin.id, 'login.mfa_failed', { ip })
      return status(401, { error: 'invalid_code' })
    }
    await redis.del(key, `${key}:tries`)
    const session = await issueSession(admin.id, ip, request.headers.get('x-client-ua') ?? '')
    await audit(admin.id, 'login.success', { ip, meta: { usedBackup } })
    const [fresh] = await db.select({ n: sql<number>`cardinality(${adminUsers.backupCodeHashes})::int` }).from(adminUsers).where(eq(adminUsers.id, admin.id))
    return { sessionToken: session.token, expiresAt: session.expiresAt, backupCodesLeft: fresh?.n ?? 0, usedBackup }
  }, { body: t.Object({ challenge: t.String({ maxLength: 100 }), code: t.Optional(t.String({ maxLength: 10 })), backupCode: t.Optional(t.String({ maxLength: 32 })) }) })

  // ---- First-time setup (invite link from the admin:invite CLI) ------------------------------------
  .post('/setup/check', async ({ body, status }) => {
    const admin = await findInvite(body.token)
    if (!admin) return status(404, { error: 'invalid_or_expired' })
    return { email: admin.email }
  }, { body: t.Object({ token: t.String({ maxLength: 100 }) }) })
  .post('/setup/begin', async ({ body, request, set, status }) => {
    const wait = await hit(`admin:setup:ip:${callerIp(request)}`, 20, 900)
    if (wait) { set.status = 429; return tooMany(set, wait) }
    const admin = await findInvite(body.token)
    if (!admin) return status(404, { error: 'invalid_or_expired' })
    const problem = passwordProblem(body.password, admin.email)
    if (problem) return status(422, { error: 'weak_password', message: problem })
    const secret = newTotpSecret()
    await db.update(adminUsers).set({ passwordHash: await Bun.password.hash(body.password, { algorithm: 'argon2id' }), totpSecretEnc: encrypt(secret) }).where(eq(adminUsers.id, admin.id))
    return { email: admin.email, secret, otpauthUri: otpauthUri(admin.email, secret) }
  }, { body: t.Object({ token: t.String({ maxLength: 100 }), password: t.String({ maxLength: 256 }) }) })
  .post('/setup/confirm', async ({ body, request, set, status }) => {
    const ip = callerIp(request)
    const wait = await hit(`admin:setup:ip:${ip}`, 20, 900)
    if (wait) { set.status = 429; return tooMany(set, wait) }
    const admin = await findInvite(body.token)
    if (!admin || !admin.totpSecretEnc || !admin.passwordHash) return status(404, { error: 'invalid_or_expired' })
    if ((await redis.incr(`admin:setup:tries:${admin.id}`)) > 10) return status(429, { error: 'too_many_requests' })
    if (verifyTotp(decrypt(admin.totpSecretEnc), body.code.trim()) === null) return status(422, { error: 'invalid_code' })
    const { codes, hashes } = newBackupCodes()
    // Consume the invite: the token stops working the moment MFA is enrolled.
    await db.update(adminUsers).set({ totpEnabledAt: new Date(), backupCodeHashes: hashes, setupTokenHash: null, setupExpiresAt: null, failedLogins: 0 }).where(eq(adminUsers.id, admin.id))
    await audit(admin.id, 'setup.completed', { ip })
    return { backupCodes: codes } // shown exactly once
  }, { body: t.Object({ token: t.String({ maxLength: 100 }), code: t.String({ maxLength: 10 }) }) })

async function findInvite(token: string) {
  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.setupTokenHash, sha256(token))).limit(1)
  if (!admin || !admin.setupExpiresAt || admin.setupExpiresAt < new Date() || admin.disabledAt || admin.totpEnabledAt || !adminEmailAllowed(admin.email)) return null
  return admin
}

// ---- Signed-in endpoints ---------------------------------------------------------------------------
export const adminSessionRoutes = new Elysia({ prefix: '/admin' }).use(adminAuthed)
  .get('/me', async ({ admin }) => {
    const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(reports).where(eq(reports.status, 'open'))
    return { email: admin.email, lastLoginAt: admin.lastLoginAt, backupCodesLeft: admin.backupCodeHashes.length, openReports: open?.n ?? 0 }
  })
  .post('/auth/logout', async ({ admin, sessionHash, ip }) => {
    await db.delete(adminSessions).where(eq(adminSessions.tokenHash, sessionHash))
    await audit(admin.id, 'logout', { ip })
    return { ok: true }
  })
