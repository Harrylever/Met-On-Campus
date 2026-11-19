import type { NextConfig } from 'next'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// A static, no-login site with one same-origin JSON endpoint (POST /volunteers/apply): strict framing/transport rules,
// and a CSP that allows the inline bootstrap scripts Next emits for prerendered pages. The volunteer form submits with
// fetch (connect-src 'self'), so form-action stays 'none'. (The staff platform, which has auth, uses nonces instead.)
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : ''),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://images.unsplash.com",
  "font-src 'self'",
  "connect-src 'self'" + (process.env.NODE_ENV !== 'production' ? ' ws:' : ''),
  "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
].join('; ')

const config: NextConfig = {
  turbopack: { root: join(dirname(fileURLToPath(import.meta.url)), '..', '..') }, // Bun workspace: Next lives at the repo root
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'Content-Security-Policy', value: csp },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    ] }]
  },
}
export default config
