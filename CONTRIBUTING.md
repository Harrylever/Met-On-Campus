# Contributing to Met On Campus

Met On Campus is a student-built, open-source app that helps students find study partners, friends and (optionally) dates on their own campus. It is licensed under the [AGPL-3.0](LICENSE). Contributions from other student developers are very welcome: bug fixes, tests, accessibility, new features, docs.

## How a change gets in

`main` is protected. Nobody pushes to it directly, including the maintainers; every change arrives as a pull request.

1. **Fork** the repo (or, if you are a maintainer, branch from `main`).
2. **Branch** with a short, descriptive name: `fix/invite-button-label`, `feat/room-reminders`, `docs/setup-notes`.
3. **Make the change, with tests** (see [Tests](#tests)).
4. **Open a pull request** against `main` and fill in the template. Keep it focused: one change per PR is much easier to review than five.
5. **CI must pass** before it can merge: `check` (migrations, web build, typecheck, API tests, web unit tests) and `e2e` (real-browser tests).
6. A maintainer reviews it. Expect questions and small requests; that is normal and not a rejection.

Merging to `main` deploys the API (Railway) and the apps (Vercel) to real students, so reviews are careful. Small PRs get merged faster.

Not sure a feature fits? Open an issue first and describe the problem you want to solve, before writing code.

## Run it locally

You need [Bun](https://bun.sh) 1.4.4 (the version CI uses), and Postgres 17 and Redis 7 (Docker is the easiest way).

```sh
cp .env.example .env          # the defaults point at local Postgres + Redis
docker compose up -d          # or use your own Postgres/Redis (createdb metoncampus_dev)
bun install
bun run db:migrate
bun run db:seed               # optional: sample students, rooms and chats
bun run dev                   # student app :3000, API :3001
```

Signing in: request a code for any `*.edu.ng` address. With `RESEND_API_KEY` empty the code is printed in the API console. After `db:seed` you can sign in as `amina@st.futminna.edu.ng`.

The staff (platform) app needs a few extra settings; see "Platform app" in the [README](README.md). The README also explains how each part works.

## Tests

Which tests to run depends on what you changed. Before you open a PR, run what applies:

```sh
bun run typecheck                      # everything, always
bun run db:check                       # fails if you changed the schema without a migration

bun run test:setup                     # once: creates the metoncampus_test database
bun run test                           # API tests
bun run --filter @moc/web test         # student-app unit tests

createdb metoncampus_e2e               # once, for the browser tests
bunx playwright install chromium       # once, from apps/e2e
bun run --filter @moc/e2e test         # real browser, real API and database
```

- **A bug fix starts with a test that fails** because of the bug, then the fix that makes it pass.
- **API changes** need an API test (`apps/api/test`, see `helpers.ts` for ready-made students, staff and calls).
- **Logic in the student app** (names, labels, messages) gets a fast unit test next to the code.
- **Browser tests are for the important journeys** that cross the screens and the API (signing in, inviting, staff actions). Keep them few and meaningful; they are the slowest tests. They also fail on any browser console error.
- The API and browser tests wipe their own `_test` / `_e2e` databases and refuse to run against anything else. They never touch your development data.

## Database changes

1. Edit `packages/db/src/schema.ts`.
2. Run `bun run db:generate`, then commit the generated SQL file and snapshot in `packages/db/drizzle/` together with the schema change. `bun run db:check` (and CI) fails if you forget.
3. Never edit a migration that has already been merged.
4. Migrations run on production **before** the new code starts, so make them safe for the old code too: add columns that are nullable or have a default, and remove things in a later PR.

## Principles that matter here

This app handles students' private conversations and, for some, romantic interest. When in doubt, choose the more private option.

- **Privacy by default.** Notifications are generic on purpose (a lock screen is seen by other people): no names, no message text, no mode. Staff can never read private chats. Collect and keep as little personal data as you can; we do not read device location.
- **Modes never mix.** Study, Friends and Romance each have their own profile and inbox. Romance is private and shown only to students who also turned it on.
- **Keep secrets and personal data out of logs.** No tokens, emails, IPs, message bodies or full URLs. The request log records route patterns (`/unsubscribe/:token`) for this reason.
- **Anything a person can repeat needs a limit.** Per student, never per IP (a whole campus can share one Wi-Fi address). See `LIMITS` in `apps/api/src/ratelimit.ts`.
- **Meetups are in public places only**, from the list staff manage for each campus.
- **Be accessible.** The target is WCAG 2.2 AA: labels, focus, keyboard use, readable contrast.

## Code and commits

- TypeScript, strict. Follow the style of the code around your change. There is no auto-formatter, so please do not reformat lines you did not change; it buries the real change in the diff.
- Comments explain **why**, not what.
- Commit messages start with a type (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), are written in the imperative, and say why in the body when it is not obvious.
- If an AI assistant helped, you are still responsible for the result: read it, run the tests, and be able to explain it in review.

## Bugs, ideas and security

- **Bugs and ideas:** open an [issue](https://github.com/Harrylever/Met-On-Campus/issues/new/choose) with the template. Say what you expected and what happened.
- **Security problems:** do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contribution is licensed under the [AGPL-3.0](LICENSE), like the rest of the project.
