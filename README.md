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
- **Photo review.** Staff see each pending photo with the student's name, campus and mode, and every approval, rejection and take-down is in the audit log. The platform fetches the image through its own server, so the service token never reaches a browser.
- **Data path.** The platform's server calls `/admin/*` on the API with a shared secret (`ADMIN_API_TOKEN`) plus the staff member's session. The browser never talks to the API from this app, and the database stays private.
- **Departments and campus spots** are managed on the platform (Departments, Campus spots). An entry can be offered to every campus or to one; renaming carries over to every student who has it; entries students still have can be archived (no longer offered) but not deleted. The web app reads its choices from `GET /meta`, and the API checks profile departments, usual spots and meetup spots against the same lists. The migration seeds today's lists plus anything students already use. "Usually free" is a set of preset chips plus an optional note, stored as one comma-separated line (max 160 characters); the presets live in `apps/api/src/lists.ts`.
- **Department requests.** A student whose department is not listed can ask for it (onboarding or Profile: "My department isn't listed"): one open request at a time, three a day, and a name already on the list is refused with a pointer to it. Until it is decided they show as "Department pending" (stored as `Unspecified`, which never counts as "the same department" for Romance's hide-from-my-department). Staff decide on the Departments page: add it as new (this campus or all), map it onto an existing department (for a misspelling), or decline with a reason. Everyone who asked for the same name on a campus is decided together; approving moves anyone still on "Unspecified" onto it, and students are notified live and see the outcome on their profile.
- **Photos.** Each mode has its own optional profile photo, and nothing is shown to anyone else until staff approve it on the platform's Photos page (approve, or reject with a reason the student sees). A replacement waits for review while the current photo stays up; staff can take a live photo down. Romance photos appear only after a match (a Spark the other person accepted), in Discover, in the conversation and at the image URL itself. Uploads are decoded from their real bytes, rotated, cropped square, re-encoded as 640px WebP and stripped of all metadata; JPEG, PNG or WebP up to 6 MB, 5 uploads a day. Images are never public URLs: `GET /photos/:id` checks the viewer on every request (same campus, same mode, not blocked, not suspended) and answers with `Cache-Control: private, max-age=300`, so a block or removal takes effect within minutes. Files live in S3-compatible storage (the Railway bucket `ergonomic-drawer`); without storage settings, dev and tests write to `apps/api/uploads/` (gitignored) and production keeps uploads switched off.
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

## Photo storage
The API reads an S3-compatible bucket from `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` and `S3_VIRTUAL_HOSTED` (all `preserve()` in `.railway/railway.ts`, so the values live only in Railway). Copy them from `railway bucket credentials`; Railway's endpoint works with path-style addressing, so keep `S3_VIRTUAL_HOSTED=false`. The bucket is declared in the config file, because `railway config apply` deletes anything the file does not list. The bucket is in `iad` while the API is in Singapore; if photos feel slow, recreate it in `sin`. Moving to Cloudflare R2 or another provider only means changing these variables.

## Database migrations
Railway runs the committed migrations before every API deploy (`preDeploy: bun run db:migrate` in `.railway/railway.ts`); a failed migration rejects the release and the old one keeps serving. It cannot create them: after changing `packages/db/src/schema.ts`, run `bun run db:generate` and commit the new SQL file and the journal. `bun run db:check` (also run by CI) fails if the schema and the migrations disagree. Local dev does not migrate for you: run `bun run db:migrate` after pulling. Deploys overlap briefly, so keep migrations additive and split anything destructive (drop or rename a column) across two deploys. Drizzle has no down-migrations; undoing a change means a new forward migration or a restore from backup.

## Design decisions
- **Modes never mix.** `intent_profiles` has one row per (user, mode); conversations are unique per (intent, pair) and the inbox API requires `intent`.
- **Romance is mutual opt-in** and honours "hide from my department" on either side (`apps/api/src/visibility.ts`).
- **Invites are answered, not assumed.** The person invited sees Accept / Not now on the Discover card and at the top of the chat. Until they answer, the inviter can send one message. Not now closes the conversation for both, hides it from the person who declined, and keeps the inviter out of their Discover; the inviter just sees it closed. If someone invites you back, you are connected at once. In Romance, an accepted Spark is the "match" that reveals photos.
- **Unread** is per conversation (`conversation_reads`, set when a chat is opened with the tab in view). `GET /me/unread` counts, per mode, chats with unread messages plus unanswered invites; the web app shows it on the Messages tab, each mode tab, each chat and the browser tab title. Pushes over the WebSocket keep it live.
- **Discover** sends a page at a time (`limit`, default 24, max 100) with the `total` and online count for everyone who matches, and supports `q` (name, prompt, bio or tag). The web app keeps your filters and search for the tab session and loads more on request. The API still filters in memory per campus, which is fine for thousands of students; move it into SQL if a campus grows far beyond that.
- **Chats** return the newest 200 messages (oldest first), and a meetup proposal can no longer be answered once its time has passed.
- **Names** are a first name or nickname, letters only (never a matric number). Onboarding asks for it; accounts created before that were named from the email address and get a one-time prompt. An existing name can always be kept, so it never blocks saving other details.
- **"Online now"** means the app is open, not that someone is on campus, and the interface says so until geofencing or a manual toggle exists.
- **Meetups** can only be proposed at public campus spots (`CAMPUS_SPOTS`); only the recipient can accept/decline.
- **On Campus Now** lives only in Redis: a per-user key with `EX` (`PRESENCE_TTL_SECONDS`, default 90s) plus a ZSET index for listing. The web app sends a WS `presence` frame every 30s; stop and you expire.
- **Auth limits** (Redis): 1 code/min and 5/hr per address, 20/hr per IP, 15 verify attempts per 15 min per address. Set `TRUST_PROXY=true` only behind a proxy that overwrites `X-Forwarded-For`.
- **Blocking** hides two students from each other everywhere (Discover, rooms, new connections) and freezes any existing chat: hidden, unreadable, unwritable. **Reports** snapshot the reported message so reviewers still see it if it's deleted; there's no admin UI yet, so review them in the `reports` table.
- Room approvals lock the room row so concurrent approvals can't exceed capacity.
- **Rooms are hosted, edited and cancelled by their host.** Editing tells everyone who has a place; spots cannot drop below the people already in. Cancelling keeps the row (`cancelled_at`), hides the room from everyone except people who had a place or were waiting (they see it marked cancelled, as news), and closes it to new requests. Answers and cancellations are "news" until the member opens Rooms (`room_members.decision_seen_at`); hosts are told how many people are waiting. `GET /me/unread` returns a `rooms` count that drives the Rooms tab badge.
- **Profile edits are never lost silently.** Each mode's form stays mounted, so switching tabs keeps what you typed; a mode with unsaved changes gets a dot, and leaving the page asks first.

## Not built yet
Geofenced presence (currently: app open = on campus), notifications, web and end-to-end tests, rate limits on non-auth endpoints, an admin/moderation UI for reports.
