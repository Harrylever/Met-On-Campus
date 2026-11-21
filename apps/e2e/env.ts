// Everything the browser tests share: ports, the throwaway database, and the staff account they sign in with.
// These are TEST-ONLY values for a throwaway database that is wiped on every run (prepare.ts refuses any database whose
// name does not end in _e2e). Never reuse them anywhere real.

// Different ports from `bun run dev` (3000 / 3001 / 3100), so the tests can run while a development server is up.
export const PORTS = { web: 3200, api: 3201, platform: 3300 }
export const URLS = {
  web: `http://localhost:${PORTS.web}`,
  api: `http://localhost:${PORTS.api}`,
  platform: `http://localhost:${PORTS.platform}`,
}

export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/metoncampus_e2e"
export const REDIS_URL =
  process.env.E2E_REDIS_URL ?? "redis://localhost:6379/13"

export const STAFF = {
  email: "staff@e2e.test",
  password: "e2e-only-password-correct-horse-1",
  totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", // base32, what an authenticator app would hold
}

/** The API server's environment. */
export const API_ENV: Record<string, string> = {
  DATABASE_URL,
  REDIS_URL,
  PORT: String(PORTS.api),
  WEB_ORIGIN: URLS.web,
  PLATFORM_URL: URLS.platform,
  ADMIN_API_TOKEN: "e2e-only-service-token-0123456789abcdefghij",
  ADMIN_ENCRYPTION_KEY: "ZGFYvPYPjoNIoQv7hqhjPVmafZ8eNT8KDnq4kkHC/dI=",
  PLATFORM_ADMIN_EMAILS: STAFF.email,
  RESEND_API_KEY: "", // codes stay in the dev outbox, which /dev/outbox/:email reads
  ALERTS_ENABLED: "false",
  TRUST_PROXY: "false",
  // TEST-ONLY fake LiveKit settings so the UI treats online rooms as available. Nothing here is a real server or key, and
  // the tests never click "Join voice", so nothing ever connects.
  LIVEKIT_URL: "wss://e2e.invalid",
  LIVEKIT_API_KEY: "e2e-only-livekit-key",
  LIVEKIT_API_SECRET: "e2e-only-livekit-secret-0123456789abcdef",
  NODE_ENV: "development",
}
