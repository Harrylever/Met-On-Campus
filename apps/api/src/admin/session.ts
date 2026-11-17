import { Elysia } from 'elysia'
import { and, eq, gt } from 'drizzle-orm'
import { adminAudit, adminSessions, adminUsers } from '@moc/db'
import { db } from '../context'
import { env } from '../env'
import { safeEqual, sha256 } from './crypto'

export const ADMIN_SESSION_HOURS = 8        // absolute lifetime
export const ADMIN_IDLE_MINUTES = 30        // sign out after this long without a request
export const adminEmailAllowed = (email: string) => env.adminEmails.includes(email.trim().toLowerCase())

/**
 * Gate for every /admin/* request, run before routing/validation so unauthenticated callers learn nothing.
 * Only the platform app's server holds ADMIN_API_TOKEN. With no token configured the whole surface is a 404.
 */
export function adminServiceGate(request: Request): Response | undefined {
  const path = new URL(request.url).pathname
  if (path !== '/admin' && !path.startsWith('/admin/')) return undefined
  const given = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? ''
  if (!env.adminApiToken || env.adminApiToken.length < 32 || !safeEqual(given, env.adminApiToken)) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } })
  }
  return undefined
}

/** The staff member's browser IP as forwarded by the platform server. Only trusted because the caller holds the service token. */
export const callerIp = (request: Request) => (request.headers.get('x-client-ip') ?? 'unknown').slice(0, 64)

export async function audit(adminId: string | null, action: string, opts: { targetType?: string; targetId?: string; meta?: Record<string, unknown>; ip?: string } = {}) {
  await db.insert(adminAudit).values({
    adminId, action, targetType: opts.targetType, targetId: opts.targetId, ip: opts.ip,
    meta: opts.meta ? JSON.stringify(opts.meta).slice(0, 2000) : null,
  })
}

export async function adminFromSession(token: string | null | undefined) {
  if (!token || token.length > 200) return null
  const now = new Date()
  const [row] = await db.select({ s: adminSessions, a: adminUsers }).from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminId))
    .where(and(eq(adminSessions.tokenHash, sha256(token)), gt(adminSessions.expiresAt, now))).limit(1)
  if (!row || row.a.disabledAt || !adminEmailAllowed(row.a.email)) return null
  if (now.getTime() - row.s.lastSeenAt.getTime() > ADMIN_IDLE_MINUTES * 60_000) {
    await db.delete(adminSessions).where(eq(adminSessions.tokenHash, row.s.tokenHash))
    return null
  }
  if (now.getTime() - row.s.lastSeenAt.getTime() > 60_000) {
    await db.update(adminSessions).set({ lastSeenAt: now }).where(eq(adminSessions.tokenHash, row.s.tokenHash))
  }
  return { admin: row.a, tokenHash: row.s.tokenHash }
}

// Resolves the signed-in staff member from the X-Admin-Session header (set by the platform server from its cookie).
export const adminAuthed = new Elysia({ name: 'admin-authed' }).resolve({ as: 'scoped' }, async ({ request, status }) => {
  const found = await adminFromSession(request.headers.get('x-admin-session'))
  if (!found) return status(401, { error: 'unauthenticated' })
  return { admin: found.admin, sessionHash: found.tokenHash, ip: callerIp(request) }
})
