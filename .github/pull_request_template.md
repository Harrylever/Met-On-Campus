## What and why

<!-- What does this change, and what problem does it solve? Link the issue if there is one: "Fixes #123". -->

## How I tested it

- [ ] `bun run typecheck`
- [ ] `bun run test` (API) and `bun run --filter @moc/web test`, with new tests for what I changed (a bug fix has a test that failed before)
- [ ] `bun run --filter @moc/e2e test`, if I changed a screen or a sign-in / invite / staff flow
- [ ] I tried it in the browser (screenshots below for visual changes)

## Database

- [ ] No schema change
- [ ] Schema change: I ran `bun run db:generate`, committed the migration and snapshot, and `bun run db:check` passes
- [ ] The migration is safe for the old code too (new columns are nullable or have a default)

## Privacy and safety

- [ ] No tokens, emails, IPs, message text or other personal data in logs or notifications
- [ ] Anything a person can repeat (sending, creating, searching) has a rate limit, per student (see `LIMITS`)
- [ ] The change keeps modes separate and respects blocking, suspension and campus boundaries

## Screenshots

<!-- For visual changes: before and after, light and dark, and a phone width if it matters. Delete this section otherwise. -->
