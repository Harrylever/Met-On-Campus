import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { sql } from 'drizzle-orm'
import { intentProfiles, sessions, users } from '@moc/db'
import { app } from '../src'
import { db, redis } from '../src/context'

const sha = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex')
export type Intent = 'study' | 'friends' | 'romance'

export async function resetAll() {
  await migrate(db, { migrationsFolder: new URL('../../../packages/db/drizzle', import.meta.url).pathname })
  await db.execute(sql`truncate table users, email_codes restart identity cascade`)
  await redis.flushdb()
}

export type TestUser = Awaited<ReturnType<typeof makeUser>>
/** Creates a verified user with a live session, bypassing email. `modes` are enabled intent profiles. */
export async function makeUser(name: string, opts: { department?: string; level?: number; modes?: Intent[]; hide?: boolean; tags?: string[]; university?: string } = {}) {
  const [u] = await db.insert(users).values({
    email: `${name.toLowerCase()}@st.${opts.university ?? 'futminna'}.edu.ng`, university: opts.university ?? 'futminna', name,
    department: opts.department ?? 'Computer Science', level: opts.level ?? 300, verifiedAt: new Date(),
  }).returning()
  for (const intent of opts.modes ?? ['study']) {
    await db.insert(intentProfiles).values({ userId: u!.id, intent, enabled: true, prompt: `${name} ${intent}`, tags: opts.tags ?? ['CSS 411'], hideFromDepartment: !!opts.hide })
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
