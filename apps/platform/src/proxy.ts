import { NextResponse, type NextRequest } from 'next/server'

const dev = process.env.NODE_ENV !== 'production'
const PUBLIC = ['/login', '/setup']

// Runs on every request: (1) strict CSP with a per-request nonce, (2) cheap "has a session cookie?" redirect.
// The real authorization check happens in the API on every data call, so a forged cookie opens nothing.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const hasSession = req.cookies.has(dev ? 'moc_platform' : '__Host-moc_platform')
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  if (!hasSession && !isPublic) return NextResponse.redirect(new URL('/login', req.url))

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'" + (dev ? ' ws:' : ''),
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')

  const headers = new Headers(req.headers)
  headers.set('x-nonce', nonce)
  headers.set('content-security-policy', csp)
  const res = NextResponse.next({ request: { headers } })
  res.headers.set('content-security-policy', csp)
  return res
}

// Static assets (icons) must load on the sign-in page, before there is a session.
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'] }
