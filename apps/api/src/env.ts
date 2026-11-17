const num = (v: string | undefined, d: number) =>
  v && !Number.isNaN(Number(v)) ? Number(v) : d

export const env = {
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://localhost:5432/metoncampus_dev",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  port: num(process.env.API_PORT, 3001),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  emailSuffixes: (process.env.ALLOWED_EMAIL_SUFFIXES ?? ".edu.ng")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  presenceTtl: num(process.env.PRESENCE_TTL_SECONDS, 90),
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  resendApiUrl: process.env.RESEND_API_URL ?? 'https://api.resend.com/emails',
  emailFrom: process.env.EMAIL_FROM ?? 'Met On Campus <onboarding@resend.dev>',
  // Only true behind a proxy that overwrites X-Forwarded-For; otherwise clients could spoof their IP.
  trustProxy: process.env.TRUST_PROXY === 'true',
  isProd: process.env.NODE_ENV === "production",
}
