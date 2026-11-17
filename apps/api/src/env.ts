const num = (v: string | undefined, d: number) =>
  v && !Number.isNaN(Number(v)) ? Number(v) : d

export const env = {
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://localhost:5432/metoncampus_dev",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  // Hosts like Railway inject PORT; API_PORT is the local-dev override.
  port: num(process.env.PORT ?? process.env.API_PORT, 3001),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  emailSuffixes: (process.env.ALLOWED_EMAIL_SUFFIXES ?? ".edu.ng")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  presenceTtl: num(process.env.PRESENCE_TTL_SECONDS, 90),
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  resendApiUrl: process.env.RESEND_API_URL ?? "https://api.resend.com/emails",
  emailFrom: process.env.EMAIL_FROM ?? "Met On Campus <onboarding@resend.dev>",
  // Only true behind a proxy that overwrites X-Forwarded-For; otherwise clients could spoof their IP.
  trustProxy: process.env.TRUST_PROXY === "true",
  // Platform (staff) app. /admin/* is disabled (404) unless ADMIN_API_TOKEN is set to a long random secret.
  adminApiToken: process.env.ADMIN_API_TOKEN ?? "",
  // Only these addresses can ever have a staff account, regardless of what is in the database.
  adminEmails: (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  // 32 random bytes, base64. Encrypts TOTP secrets at rest.
  adminEncryptionKey: process.env.ADMIN_ENCRYPTION_KEY ?? "",
  platformUrl: process.env.PLATFORM_URL ?? "https://platform.metoncampus.xyz",
  isProd: process.env.NODE_ENV === "production",
}
