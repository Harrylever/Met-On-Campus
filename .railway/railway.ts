import {
  defineRailway,
  github,
  postgres,
  preserve,
  bucket,
  project,
  redis,
  service,
  volume,
} from "railway/iac"

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "asia-southeast1-eqsg3a" })
  Postgres.networking = { privateNetworkEndpoint: "postgres" }
  const Redis = redis("Redis", { region: "asia-southeast1-eqsg3a" })
  Redis.deploy = {
    startCommand:
      '/bin/sh -c "rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH"',
  }
  Redis.networking = { privateNetworkEndpoint: "redis" }
  const redisVolume = volume("redis-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "asia-southeast1-eqsg3a",
    sizeMB: 5000,
  })
  const postgresVolume = volume("postgres-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "asia-southeast1-eqsg3a",
    sizeMB: 5000,
  })
  // Student photos (private; served only through the API). Declared here so `railway config apply` keeps it.
  const photos = bucket("ergonomic-drawer", { region: "iad" })
  const _mocapi = service("@moc/api", {
    source: github("Harrylever/Met-On-Campus", {
      branch: "main",
      checkSuites: false,
    }),
    build: {
      buildEnvironment: "V3",
      builder: "RAILPACK",
      watchPatterns: ["/apps/api/**"],
    },
    start: "bun run --filter=@moc/api start",
    // Runs before each deploy goes live; a failed migration aborts the release and keeps the old version serving.
    preDeploy: "bun run db:migrate",
    healthcheck: "/health",
    // Cookies are SameSite=Lax, so the API and the web app (Vercel) must share a parent domain.
    // Registered in the dashboard/CLI (IaC cannot create custom domains); listed here to stay in sync.
    domains: ["jeer.metoncampus.xyz"],
    replicas: { "asia-southeast1-eqsg3a": 1 },
    networking: { privateNetworkEndpoint: "mocapi" },
    env: {
      PORT: "8080", // must match the domain's target port; the API reads PORT
      NODE_ENV: "production", // Secure cookies, and the API refuses to boot without a Resend key
      TRUST_PROXY: "true", // Railway's edge sets X-Real-IP; needed so rate limits are per user, not per proxy
      WEB_ORIGIN: "https://app.metoncampus.xyz", // the single origin allowed by CORS
      ALLOWED_EMAIL_SUFFIXES: ".edu.ng",
      PUBLIC_API_URL: "https://jeer.metoncampus.xyz", // where email links (unsubscribe) point
      ALERTS_ENABLED: "true", // "something is waiting" emails; they are off by default outside production
      PRESENCE_TTL_SECONDS: "90",
      EMAIL_FROM: "Met On Campus <noreply@yes.metoncampus.xyz>",
      // Secrets and connection strings stay in Railway; the file only keeps them managed.
      // Platform (staff) app. /admin/* is a 404 until ADMIN_API_TOKEN exists. Values live only in Railway:
      PLATFORM_URL: "https://platform.metoncampus.xyz",
      ADMIN_API_TOKEN: preserve(), // shared with the platform app's server, 32+ random characters
      ADMIN_ENCRYPTION_KEY: preserve(), // 32 random bytes, base64; encrypts staff TOTP secrets at rest
      PLATFORM_ADMIN_EMAILS: preserve(), // comma-separated allowlist of staff addresses
      DATABASE_URL: preserve(),
      REDIS_URL: preserve(),
      RESEND_API_KEY: preserve(),
      // Web push. Generate a pair with `bun run push:keys` in apps/api; the public half is served to browsers, the private half stays here.
      VAPID_PUBLIC_KEY: preserve(),
      VAPID_PRIVATE_KEY: preserve(),
      VAPID_SUBJECT: "mailto:hello@metoncampus.xyz",
      // Photo storage (the project's Railway bucket). Values live only in Railway; without them uploads stay switched off.
      S3_ENDPOINT: preserve(),
      S3_BUCKET: preserve(),
      S3_ACCESS_KEY_ID: preserve(),
      S3_SECRET_ACCESS_KEY: preserve(),
      S3_REGION: preserve(),
      S3_VIRTUAL_HOSTED: preserve(),
    },
  })

  return project("ravishing-freedom", {
    variables: { managed: true },
    resources: [Postgres, Redis, _mocapi, redisVolume, postgresVolume, photos],
  })
})
