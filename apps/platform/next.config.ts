import type { NextConfig } from 'next'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Staff-only app: never indexed, never framed, never cached by shared caches.
// The Content-Security-Policy (with a per-request nonce) is set in src/proxy.ts.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
  { key: 'Cache-Control', value: 'no-store' },
]

const config: NextConfig = {
  // Bun workspace: Next is installed at the repo root, so Turbopack must treat the root as the workspace.
  turbopack: { root: join(dirname(fileURLToPath(import.meta.url)), '..', '..') },
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() { return [{ source: '/:path*', headers: securityHeaders }] },
}
export default config
