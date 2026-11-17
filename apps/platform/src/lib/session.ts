import 'server-only'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

const prod = process.env.NODE_ENV === 'production'
// __Host- cookies must be Secure, Path=/, and have no Domain: the browser then refuses to let a sibling
// subdomain (e.g. app.metoncampus.xyz) overwrite them. Plain http://localhost can't set Secure ones.
export const SESSION_COOKIE = prod ? '__Host-moc_platform' : 'moc_platform'
export const CHALLENGE_COOKIE = prod ? '__Host-moc_challenge' : 'moc_challenge'

export const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true, secure: prod, sameSite: 'strict' as const, path: '/', maxAge: maxAgeSeconds,
})

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null
}

/** Pages call this first: no session cookie means no need to ask the API. */
export async function requireSession() {
  const token = await sessionToken()
  if (!token) redirect('/login')
  return token
}

/** The staff member's IP as seen by the edge, forwarded so the API can rate-limit and audit it. */
export async function clientIp() {
  const h = await headers()
  return h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}
export async function clientAgent() {
  return ((await headers()).get('user-agent') ?? '').slice(0, 200)
}
