import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { sql } from 'drizzle-orm'
import { adminSessions, adminUsers, campuses, campusSpots, DEFAULT_DEPARTMENTS, DEFAULT_SPOTS, departments, intentProfiles, sessions, users } from '@moc/db'
import { eq } from 'drizzle-orm'
import { encrypt, hashBackupCode, newBackupCodes } from '../src/admin/crypto'
import { hotp, base32Decode, newTotpSecret } from '../src/admin/totp'
import { app } from '../src'
import { db, redis } from '../src/context'
import { setLiveKit, type LiveKit, type Participant } from '../src/livekit'

const sha = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex')
export type Intent = 'study' | 'friends' | 'romance'

/** The campuses every test starts with (both open, each with its own copy of the default lists). */
export const TEST_CAMPUSES = [['futminna', 'FUTMinna'], ['unilag', 'UNILAG']] as const

export async function resetAll() {
  await migrate(db, { migrationsFolder: new URL('../../../packages/db/drizzle', import.meta.url).pathname })
  await db.execute(sql`truncate table users, email_codes, admin_users, admin_audit restart identity cascade`)
  // The lists are staff-editable, so every test starts from the same state the migration leaves: the template (rows with no
  // campus), two open campuses that each have their own copy of it, and nothing else. Anything else a test needs it opens itself.
  await db.execute(sql`truncate table departments, campus_spots, campuses, campus_interest, push_broadcasts`)
  await db.insert(departments).values(DEFAULT_DEPARTMENTS.map((name, i) => ({ name, sortOrder: (i + 1) * 10 })))
  await db.insert(campusSpots).values(DEFAULT_SPOTS.map((name, i) => ({ name, sortOrder: (i + 1) * 10 })))
  for (const [slug, name] of TEST_CAMPUSES) {
    await db.insert(campuses).values({ slug, name })
    await db.insert(departments).values(DEFAULT_DEPARTMENTS.map((d, i) => ({ name: d, university: slug, sortOrder: (i + 1) * 10 })))
    await db.insert(campusSpots).values(DEFAULT_SPOTS.map((d, i) => ({ name: d, university: slug, sortOrder: (i + 1) * 10 })))
  }
  await redis.flushdb()
  setLiveKit(fakeLiveKit())
}

/** A controllable in-memory LiveKit. `failNext()` makes the very next call throw; `setConfigured(false)` simulates missing settings. */
export function fakeLiveKit() {
  const rooms = new Map<string, Participant[]>()
  let isConfigured = true
  let failing = false
  const guard = () => { if (failing) { failing = false; throw new Error('livekit down') } }
  const fake = {
    closed: [] as string[],
    removed: [] as { room: string; identity: string }[],
    ensured: [] as { room: string; maxParticipants: number }[],
    tokens: [] as { room: string; identity: string; name: string; expiresAt: Date }[],
    setParticipants(room: string, list: Participant[]) { rooms.set(room, list) },
    setConfigured(v: boolean) { isConfigured = v },
    failNext() { failing = true },
    configured: () => isConfigured,
    url: () => 'wss://livekit.test',
    async issueToken(a: { room: string; identity: string; name: string; expiresAt: Date }) { guard(); fake.tokens.push(a); return `fake-token:${a.room}:${a.identity}` },
    async ensureRoom(room: string, maxParticipants: number) { guard(); fake.ensured.push({ room, maxParticipants }); if (!rooms.has(room)) rooms.set(room, []) },
    async participants(room: string) { guard(); return [...(rooms.get(room) ?? [])] },
    async closeRoom(room: string) { guard(); fake.closed.push(room); rooms.delete(room) },
    async removeParticipant(room: string, identity: string) {
      guard(); fake.removed.push({ room, identity })
      const list = rooms.get(room); if (list) rooms.set(room, list.filter((p) => p.identity !== identity))
    },
  } satisfies LiveKit & Record<string, unknown>
  return fake
}

export type TestUser = Awaited<ReturnType<typeof makeUser>>
/** Creates a verified user with a live session, bypassing email. `modes` are enabled intent profiles. */
export async function makeUser(name: string, opts: { department?: string; level?: number; modes?: Intent[]; hide?: boolean; tags?: string[]; university?: string; gender?: 'male' | 'female'; showGender?: boolean; premium?: boolean } = {}) {
  const [u] = await db.insert(users).values({
    email: `${name.toLowerCase()}@st.${opts.university ?? 'futminna'}.edu.ng`, university: opts.university ?? 'futminna', name,
    department: opts.department ?? 'Computer Science', level: opts.level ?? 300, verifiedAt: new Date(), gender: opts.gender ?? null,
    premiumUntil: opts.premium ? new Date(Date.now() + 30 * 864e5) : null,
  }).returning()
  for (const intent of opts.modes ?? ['study']) {
    await db.insert(intentProfiles).values({ userId: u!.id, intent, enabled: true, prompt: `${name} ${intent}`, tags: opts.tags ?? ['CSS 411'], hideFromDepartment: !!opts.hide, showGender: opts.showGender ?? true })
  }
  const token = `tok-${name}-${crypto.randomUUID()}`
  await db.insert(sessions).values({ tokenHash: sha(token), userId: u!.id, expiresAt: new Date(Date.now() + 864e5) })
  return { ...u!, token }
}

/** Call the app in-process (no network). Returns status + parsed JSON. */
export async function call(user: { token: string } | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(user ? { cookie: `moc_session=${user.token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }))
  const text = await res.text()
  let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, headers: res.headers }
}

// ---- Staff helpers ----------------------------------------------------------------------------------
export const SERVICE_TOKEN = process.env.ADMIN_API_TOKEN!
export const currentCode = (secret: string, at = Date.now()) => hotp(base32Decode(secret), Math.floor(at / 30_000))
export const PASSWORD = 'correct horse battery staple 42'

/** A fully enrolled staff account (password + TOTP + backup codes), created directly in the database. */
export async function makeAdmin(email = 'root@platform.test', opts: { password?: string } = {}) {
  const secret = newTotpSecret()
  const { codes, hashes } = newBackupCodes()
  const password = opts.password ?? PASSWORD
  const [a] = await db.insert(adminUsers).values({
    email, passwordHash: await Bun.password.hash(password, { algorithm: 'argon2id' }), totpSecretEnc: encrypt(secret),
    totpEnabledAt: new Date(), backupCodeHashes: hashes,
  }).returning()
  return { ...a!, password, secret, backupCodes: codes }
}

/** Call /admin/* the way the platform server does: service token, optional staff session, optional forwarded IP. */
export async function adminCall(method: string, path: string, body?: unknown, o: { session?: string; token?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = { 'x-client-ip': o.ip ?? '203.0.113.9' }
  if (o.token !== null) headers.authorization = `Bearer ${o.token ?? SERVICE_TOKEN}`
  if (o.session) headers['x-admin-session'] = o.session
  return call(null, method, path, body, headers)
}

/** Full password + TOTP login. Returns the session token. */
export async function adminLogin(a: { email: string; password: string; secret: string }, ip?: string) {
  const l = await adminCall('POST', '/admin/auth/login', { email: a.email, password: a.password }, { ip })
  if (l.status !== 200) throw new Error(`login failed: ${l.status} ${JSON.stringify(l.json)}`)
  // Test convenience only: let the helper sign in repeatedly inside one 30s window (the replay test uses adminCall directly).
  for (const k of await redis.keys('admin:totp:used:*')) await redis.del(k)
  const m = await adminCall('POST', '/admin/auth/mfa', { challenge: l.json.challenge, code: currentCode(a.secret) }, { ip })
  if (m.status !== 200) throw new Error(`mfa failed: ${m.status} ${JSON.stringify(m.json)}`)
  return m.json.sessionToken as string
}
export { eq, adminSessions, hashBackupCode }
