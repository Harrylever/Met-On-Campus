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
  // Photo storage. Any S3-compatible bucket (Railway, Cloudflare R2, GCS interop). With none set, files go to a local
  // folder in dev and tests; in production photo uploads stay switched off until a bucket is configured.
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? "",
    bucket: process.env.S3_BUCKET ?? "",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    region: process.env.S3_REGION ?? "auto",
    // Railway buckets use virtual-hosted addressing (bucket in the hostname); path-style is the S3 default elsewhere.
    virtualHosted: process.env.S3_VIRTUAL_HOSTED === "true",
  },
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  // Where this API is reachable from outside (used in email links, e.g. unsubscribe).
  publicApiUrl: (process.env.PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "https://jeer.metoncampus.xyz" : `http://localhost:${process.env.PORT ?? process.env.API_PORT ?? 3001}`)).replace(/\/$/, ""),
  // "Something is waiting" emails run only in production unless switched on (so dev and tests never email or spam the console).
  alertsEnabled: (process.env.ALERTS_ENABLED ?? (process.env.NODE_ENV === "production" ? "true" : "false")) === "true",
  isProd: process.env.NODE_ENV === "production",
}
