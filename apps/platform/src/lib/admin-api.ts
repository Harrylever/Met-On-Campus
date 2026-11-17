import 'server-only'
import { redirect } from 'next/navigation'
import { clientAgent, clientIp, requireSession } from './session'

// The only code that talks to the API, and only from the server. ADMIN_API_TOKEN never reaches a browser.
const BASE = process.env.ADMIN_API_URL ?? 'http://localhost:3001'
const TOKEN = process.env.ADMIN_API_TOKEN ?? ''

export type ApiResult<T> = { status: number; ok: boolean; data: T }

export async function rawAdminApi<T = any>(path: string, opts: { method?: string; body?: unknown; session?: string | null } = {}): Promise<ApiResult<T>> {
  if (!TOKEN) throw new Error('ADMIN_API_TOKEN is not set')
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-client-ip': await clientIp(),
      'x-client-ua': await clientAgent(),
      ...(opts.session ? { 'x-admin-session': opts.session } : {}),
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, data: data as T }
}

/** Authenticated call. An expired/revoked session sends the person back to sign in. */
export async function adminApi<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  const session = await requireSession()
  const r = await rawAdminApi<T>(path, { ...opts, session })
  if (r.status === 401) redirect('/login?expired=1')
  return r
}

/** For pages that cannot render without data. */
export async function adminData<T = any>(path: string): Promise<T> {
  const r = await adminApi<T>(path)
  if (!r.ok) throw new Error(`API ${path} returned ${r.status}`)
  return r.data
}

/** A photo's bytes for the review screen. Server-only, so the service token and staff session never reach a browser. */
export async function adminImage(id: string): Promise<Response> {
  const session = await requireSession()
  const res = await fetch(`${BASE}/admin/photos/${id}/image`, {
    headers: { authorization: `Bearer ${TOKEN}`, 'x-client-ip': await clientIp(), 'x-admin-session': session },
    cache: 'no-store', signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return new Response('Not found', { status: res.status === 401 ? 401 : 404 })
  return new Response(res.body, { headers: { 'content-type': 'image/webp', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
}
