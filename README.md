# Met On Campus

Bun workspaces monorepo.

| Path | What |
|---|---|
| `apps/web` | TanStack Start (React, Vite, Tailwind v4). Talks to the API through Eden Treaty. |
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

## Tests
```sh
bun run test:setup   # once: creates the metoncampus_test database
bun run test         # API tests: visibility rules, auth + rate limits, blocking/reporting, meetups, rooms
```
Tests run in-process against a real Postgres and Redis (db 15). They truncate tables and flush Redis, so the setup refuses any database whose name doesn't end in `_test`. CI (`.github/workflows/ci.yml`) runs build, typecheck and tests on every push and PR.

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
