# Met On Campus

Bun workspaces monorepo.

| Path | What |
|---|---|
| `apps/web` | TanStack Start (React, Vite, Tailwind v4). Talks to the API through Eden Treaty. |
| `apps/marketing` | Next.js marketing site for metoncampus.xyz (static; see Marketing site). |
| `apps/platform` | Next.js staff monitoring app (see below). |
| `apps/api` | ElysiaJS on Bun: REST + native WebSocket (`/ws`). Exports `type App` for Eden. |
| `packages/db` | Drizzle ORM schema + migrations (PostgreSQL). |

## Run

```sh
cp .env.example .env          # defaults point at local Postgres + Redis
docker compose up -d          # or use your own Postgres/Redis (createdb metoncampus_dev)
bun install
bun run db:migrate
bun run dev                   # web :3000, api :3001
```

Dev sign-in: request a code for any `*.edu.ng` address. With `RESEND_API_KEY` empty the code prints in the API console; set it (plus `EMAIL_FROM` on your verified Resend domain) to send real email. Production refuses to boot without the key.
`bun run db:seed` loads sample students, rooms and chats (sign in as `amina@st.futminna.edu.ng`).

## Marketing site
`apps/marketing` is a static Next.js site for the root domain: home (with an interactive mode preview), safety, universities, terms and privacy. It sets no cookies, loads no analytics, and every call to action points at the app (`NEXT_PUBLIC_APP_URL`).

- `/join` is a "scan to join" page for showing people: a large QR code for `NEXT_PUBLIC_APP_URL` (always dark on white, even in dark mode), the typed address, three steps, PNG/SVG downloads for posters and chats, and a print layout. The code is generated at build time in `src/lib/qr.ts`; if the app URL changes, rebuild and redownload the files. It is noindexed and not in the sitemap.
- Local: `bun run dev` (marketing on :3200).
- Env (not secret, baked into the build): `NEXT_PUBLIC_SITE_URL` (default `https://metoncampus.xyz`), `NEXT_PUBLIC_APP_URL` (default `https://app.metoncampus.xyz`), `NEXT_PUBLIC_CONTACT_EMAIL` (defaults to `hello@metoncampus.xyz`, which Cloudflare Email Routing forwards to a personal inbox; set the variable only to override it). If it is ever set to empty, the universities and legal pages say contact details are coming.
- Vercel (new project): Root Directory `apps/marketing`, "Include source files outside of the Root Directory" on. Add the domain `metoncampus.xyz` and redirect `www.metoncampus.xyz` to it.
- The hero photos are from Unsplash (`src/lib/photos.ts`), hotlinked from their CDN with the photographer credit shown on the card, as Unsplash's guidelines require. To swap one, search the Unsplash API, call the photo's `download_location` once when you pick it, and update that file. The CSP allows only `images.unsplash.com` for remote images. The Unsplash key is only needed while choosing photos, so keep it out of the repo (`apps/marketing/.env.local` is gitignored).
- The terms and privacy pages are a plain-language starting point written from how the product works today. Have a Nigerian lawyer review them, and update them (and `updated` in `src/lib/site.ts`) whenever data practices change.

## Platform app (staff monitoring)
`apps/platform` is a separate Next.js app for `platform.metoncampus.xyz`: overview metrics, reports queue with moderation (dismiss / record warning / suspend), student lookup, live activity, service health + Railway deployments, and an audit log.

- **No public sign-up.** Staff are created with `bun run admin invite <email>` (prints a one-time, 24h setup link). The address must also be in the API's `PLATFORM_ADMIN_EMAILS`. Login is email + password (argon2id) + authenticator code, with 10 single-use backup codes. 5 failures lock the account for 15 minutes; sessions last 8h, 30 min idle.
- **Staff cannot read private chats.** They see counts, profiles, and the saved snapshot of a *reported* message. Every sign-in, search, profile view and moderation action is written to the audit log.
- **Data path.** The platform's server calls `/admin/*` on the API with a shared secret (`ADMIN_API_TOKEN`) plus the staff member's session. The browser never talks to the API from this app, and the database stays private.
- **Suspending** a student ends their sessions immediately, blocks sign-in, and hides them from Discover, rooms and chats. Restoring is one click.

Local: set `ADMIN_API_TOKEN`, `ADMIN_ENCRYPTION_KEY`, `PLATFORM_ADMIN_EMAILS` in `.env` (see `.env.example`) and the same token in `apps/platform/.env.local`, then `bun run dev` (platform on :3100).

Production:
1. Railway (API): set `ADMIN_API_TOKEN`, `ADMIN_ENCRYPTION_KEY`, `PLATFORM_ADMIN_EMAILS` (they are `preserve()` in `.railway/railway.ts`, so they live only in Railway), then `railway config apply`. The next deploy runs the new migration.
2. Vercel (new project): Root Directory `apps/platform`, "Include source files outside of the Root Directory" on. Env: `ADMIN_API_URL=https://jeer.metoncampus.xyz`, the same `ADMIN_API_TOKEN`, and optionally `RAILWAY_API_TOKEN` / `RAILWAY_PROJECT_ID` / `RAILWAY_ENVIRONMENT_ID` / `RAILWAY_SERVICE_ID` for the deployments panel. Add the domain `platform.metoncampus.xyz`.
3. Create your account: `railway ssh --service @moc/api -- bun apps/api/src/admin/cli.ts invite you@example.com`, open the link, set a password, scan the QR code, save the backup codes.
4. After the first deploy, confirm `/admin/overview` on the API returns 404 without the token, and that the platform's pages send the CSP and `X-Frame-Options` headers.

## Tests
```sh
bun run test:setup   # once: creates the metoncampus_test database
bun run test         # API tests: visibility rules, auth + rate limits, blocking/reporting, meetups, rooms
```
Tests run in-process against a real Postgres and Redis (db 15). They truncate tables and flush Redis, so the setup refuses any database whose name doesn't end in `_test`. CI (`.github/workflows/ci.yml`) runs build, typecheck and tests on every push and PR.

## Deploy
- **API + Postgres + Redis: Railway**, defined in `.railway/railway.ts` (`railway config plan` / `apply`). Custom domains are added with `railway domain`, not in the file's IaC engine. The API listens on `PORT`.
- **Web: Vercel.** The Vite build uses `nitro()`, which emits Vercel's output format when it detects `VERCEL=1`. Without it the deploy builds but every route 404s. Project settings:
  - Root Directory `apps/web`, with "Include source files outside of the Root Directory" on (the app imports the API's types from the workspace).
  - Framework Preset: TanStack Start (or `{ "framework": "tanstack-start" }` in `vercel.json` if detection fails in the monorepo).
  - Env var `VITE_API_URL=https://<api host>`. It is read at build time, so redeploy after changing it.
  - The API's login cookie is `SameSite=Lax`, so the web and API hosts must share a parent domain (`app.` and the API host under the same site), and the API's `WEB_ORIGIN` must equal the web origin exactly.

## Design decisions
- **Modes never mix.** `intent_profiles` has one row per (user, mode); conversations are unique per (intent, pair) and the inbox API requires `intent`.
- **Romance is mutual opt-in** and honours "hide from my department" on either side (`apps/api/src/visibility.ts`).
- **Meetups** can only be proposed at public campus spots (`CAMPUS_SPOTS`); only the recipient can accept/decline.
- **On Campus Now** lives only in Redis: a per-user key with `EX` (`PRESENCE_TTL_SECONDS`, default 90s) plus a ZSET index for listing. The web app sends a WS `presence` frame every 30s; stop and you expire.
- **Auth limits** (Redis): 1 code/min and 5/hr per address, 20/hr per IP, 15 verify attempts per 15 min per address. Set `TRUST_PROXY=true` only behind a proxy that overwrites `X-Forwarded-For`.
- **Blocking** hides two students from each other everywhere (Discover, rooms, new connections) and freezes any existing chat: hidden, unreadable, unwritable. **Reports** snapshot the reported message so reviewers still see it if it's deleted; there's no admin UI yet, so review them in the `reports` table.
- Room approvals lock the room row so concurrent approvals can't exceed capacity.

## Not built yet
Photos, geofenced presence (currently: app open = on campus), notifications, web and end-to-end tests, rate limits on non-auth endpoints, an admin/moderation UI for reports.
