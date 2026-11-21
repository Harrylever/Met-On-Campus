# Online Rooms (voice + text) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a premium host create an online (voice + text) room, and let approved members join its LiveKit call only while it is live.

**Architecture:** `rooms.mode` ('physical' | 'online') and `users.premium_until` are new columns. All LiveKit server calls go through one small wrapper (`apps/api/src/livekit.ts`) that tests replace. The API signs short-lived join tokens at `POST /rooms/:id/join`; the web app connects with `livekit-client`, and text chat rides on LiveKit's data channel (not stored). A once-a-minute in-process sweep closes calls that have passed their end time.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, Redis, `livekit-server-sdk` (API), `livekit-client` (web), React, bun:test, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-online-rooms-design.md`

## Global Constraints

- Provider is LiveKit Cloud. The API key and secret live only in environment variables `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (no defaults), never in the repo, logs or responses other than the token and URL needed to join.
- Audio only, no video; no recording, no transcripts; chat is never stored.
- Only a premium host (`premium_until > now()`) can create an online room; premium is checked only at creation. Guests join free.
- Join only while live: `startsAt <= now < endsAt`. Online rooms are at most 4 hours long (also on edit).
- Online rooms store `place = 'Online'`; `mode` cannot change after creation; `place` cannot be edited on an online room.
- Token: identity = user id, name = the student's name, audio + data publish only, expiry = the room's `endsAt`. LiveKit room name = `room:<roomId>`. One connection per student.
- Refusals: `404 not_found` (missing, other campus, physical room, or blocked with the host), `409 cancelled`, `403 not_a_member`, `409 not_live_yet`, `409 ended`, `403 premium_required`, `503 online_unavailable`, `502 voice_unavailable` (LiveKit failed; fail closed).
- Block prompt: `POST /rooms/:id/join` answers `409 { error: 'blocked_present', people: [{ name }] }` (names only, never ids) when someone the **caller** blocked is in the call, until the caller repeats with `{ acknowledgeBlocked: true }`. Blocks placed on the caller are never revealed.
- Per-student rate limit for joins: `roomJoin` = 30 per hour in `LIMITS`.
- Schema changes need a committed migration (`bun run db:generate`; CI runs `bun run db:check`) and must be safe for the old code.
- `main` rejects direct pushes: work on branch `feat/online-rooms` and open a PR. Commit messages end with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Package versions: pin exact versions at least two weeks old.

## Review Focus

- A member joins exactly at `startsAt` (allowed), exactly at `endsAt` (refused `ended`), and before start (`not_live_yet`). Test: Task 4.
- A student who was blocked by someone in the call joins normally and is told nothing; the blocker's names are never returned as ids. Test: Task 4.
- A non-premium host is refused; a host whose premium lapses after creating keeps the room and members still join. Test: Task 3 and Task 4.
- LiveKit throws or times out during `/join`: the answer is `502 voice_unavailable`, not a 500 and not a silent skip of the block check; during cancel, the room is still cancelled. Test: Task 4 and Task 5.
- A removed member cannot rejoin or re-request, the host cannot remove themselves, and a non-host cannot remove anyone. Test: Task 5.

---

### Task 1: Schema, premium flag and CLI

**Files:**
- Modify: `packages/db/src/schema.ts` (add `roomModeEnum` near `roomIntentEnum` line 8; `rooms.mode`; `users.premiumUntil`)
- Create: `packages/db/drizzle/00NN_*.sql` (generated)
- Create: `apps/api/src/premium.ts`
- Modify: `apps/api/src/admin/cli.ts` (add `premium <email> <days|off>`; update the usage line)
- Test: `apps/api/test/premium.test.ts`

**Interfaces:**
- Produces: `rooms.mode: 'physical' | 'online'` (not null, default `'physical'`); `users.premiumUntil: Date | null`; `isPremium(u: { premiumUntil: Date | null }, now?: Date): boolean`; `setPremium(email: string, days: number | null): Promise<Date | null>` (null days clears it; returns the new `premiumUntil`; throws `Error('no such student')` for an unknown email).

- [ ] **Step 1: Write failing tests** in `premium.test.ts` (use `resetAll`, `makeUser`, `db`): `existing and new rooms default to physical` (insert a room without `mode`, read it back as `'physical'`); `isPremium is false for null and past dates, true for a future date`; `setPremium sets a date N days ahead and null clears it`; `setPremium throws for an unknown email`.
- [ ] **Step 2: Run** `cd apps/api && bun test test/premium.test.ts` — Expected: FAIL (module and columns missing).
- [ ] **Step 3: Implement.** Add the enum and columns (`mode` `.notNull().default('physical')`; `premiumUntil: timestamp('premium_until', { withTimezone: true })`), run `bun run db:generate`, commit the SQL. Implement `premium.ts`, and wire the CLI command to `setPremium` printing the new date.
- [ ] **Step 4: Run** `cd apps/api && bun test test/premium.test.ts` — Expected: PASS; then `bun run db:check` — Expected: "Schema and migrations agree."
- [ ] **Step 5: Commit** `feat(db): room mode and premium_until, with a staff CLI command`.

### Task 2: LiveKit wrapper and configuration

**Files:**
- Modify: `apps/api/package.json` (add `livekit-server-sdk`, exact pinned version), `apps/api/src/env.ts` (add `livekit: { url, apiKey, apiSecret }` from the three env vars, default `""`)
- Create: `apps/api/src/livekit.ts`
- Modify: `apps/api/test/helpers.ts` (export `fakeLiveKit()` returning a controllable in-memory `LiveKit`, with `setParticipants(room, list)`, recorded `closed` and `removed` arrays, and a `failNext()` switch that makes the next call throw)
- Test: `apps/api/test/livekit.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Participant = { identity: string; name: string }
  export interface LiveKit {
    configured(): boolean
    url(): string
    issueToken(a: { room: string; identity: string; name: string; expiresAt: Date }): Promise<string>
    ensureRoom(room: string, maxParticipants: number): Promise<void>
    participants(room: string): Promise<Participant[]>   // [] if the room does not exist
    closeRoom(room: string): Promise<void>               // no-op if it does not exist
    removeParticipant(room: string, identity: string): Promise<void>
  }
  export let livekit: LiveKit
  export function setLiveKit(impl: LiveKit): void
  export const roomName: (roomId: string) => string      // `room:${roomId}`
  ```

- [ ] **Step 1: Write failing tests**: `configured() is false when any of the three values is missing`; `issueToken signs a token that verifies with the secret, with identity, name, room, audio and data publish allowed, canPublish sources limited to microphone, and an expiry equal to expiresAt` (verify with the SDK's `TokenVerifier` and the test secret); `roomName builds room:<id>`.
- [ ] **Step 2: Run** `cd apps/api && bun test test/livekit.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the default implementation on `livekit-server-sdk` (`AccessToken`, `RoomServiceClient`); the real network methods treat a "room not found" error as empty/no-op. `ensureRoom` creates the LiveKit room with `maxParticipants` and an empty-room timeout of 300 s. `setLiveKit` swaps the module-level `livekit`. In the test setup, call `setLiveKit(fakeLiveKit())` in `resetAll` so no test reaches the network.
- [ ] **Step 4: Run** `bun test test/livekit.test.ts` — Expected: PASS; `bun run typecheck` — Expected: no errors.
- [ ] **Step 5: Commit** `feat(api): LiveKit wrapper, env settings and a test double`.

### Task 3: Creating and editing online rooms

**Files:**
- Modify: `apps/api/src/routes/rooms.ts` (`POST /`, `PATCH /:id`, list response), `apps/api/src/ratelimit.ts` (add `roomJoin: [{ limit: 30, window: 3600 }]`)
- Test: `apps/api/test/online-rooms.test.ts` (new); `apps/api/test/helpers.ts` (`makeUser` accepts `premium?: boolean`, setting `premiumUntil` 30 days ahead)

**Interfaces:**
- Consumes: `isPremium`, `livekit.configured()`, `rooms.mode`.
- Produces: `POST /rooms` body gains `mode?: 'physical' | 'online'` (default physical) and `place` becomes optional (required for physical, else `422 place_required`); responses and the list include `mode`; error codes `premium_required` (403), `online_unavailable` (503), `online_too_long` (422).

- [ ] **Step 1: Write failing tests** (all via `call`, with the fake LiveKit configured unless stated): `a premium host creates an online room, place is "Online" and mode is online`; `a non-premium host is refused with 403 premium_required and nothing is created`; `creating an online room fails with 503 online_unavailable when LiveKit is not configured`; `an online room longer than 4 hours is refused with 422 online_too_long`; `a physical room still needs a place (422 place_required) and works for non-premium hosts`; `the rooms list includes mode`; `editing an online room refuses a new place (422 place_locked), refuses stretching it past 4 hours, and ignores a mode change`; `a host whose premium has lapsed can still edit and keep their online room`.
- [ ] **Step 2: Run** `cd apps/api && bun test test/online-rooms.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the checks in the order premium → configured → duration; set `place: 'Online'` server-side; add `mode` to the list and room payloads; in `PATCH`, load `room.mode` and apply the online rules (the body schema must not accept `mode`).
- [ ] **Step 4: Run** `cd apps/api && bun test` — Expected: all PASS (including existing rooms tests); `bun run typecheck`.
- [ ] **Step 5: Commit** `feat(api): premium hosts can create online rooms`.

### Task 4: Joining a live call, with the block prompt

**Files:**
- Modify: `apps/api/src/routes/rooms.ts` (add `POST /:id/join`)
- Test: `apps/api/test/online-join.test.ts`

**Interfaces:**
- Consumes: Task 2 wrapper, Task 3 columns, `isBlockedBetween`, `blocks` table, `limited(user.id, 'roomJoin', set)`.
- Produces: `POST /rooms/:id/join` body `{ acknowledgeBlocked?: boolean }` → `200 { url: string, token: string }`, or one of the refusals in Global Constraints.

- [ ] **Step 1: Write failing tests** (host, approved member, pending member, outsider; the fake LiveKit; time set via the room's start/end): `an approved member gets a url and a token whose expiry is the room end`; `the host can join`; `a pending, declined or unrelated student gets 403 not_a_member`; `joining at exactly startsAt works, one second before is 409 not_live_yet`; `joining at exactly endsAt is 409 ended`; `a cancelled room is 409 cancelled`; `a physical room, another campus's room, or a room whose host is blocked with the caller is 404 not_found`; `without LiveKit configured it is 503 online_unavailable`; `when LiveKit fails the answer is 502 voice_unavailable and no token is issued`; `the 31st join in an hour is 429`; `block prompt: if someone the caller blocked is in the call the answer is 409 blocked_present with names only (assert the JSON contains no user id), and repeating with acknowledgeBlocked true returns the token`; `a caller who was blocked BY someone in the call joins normally with no mention of it`; `a host who lost premium after creating the room can still be joined`.
- [ ] **Step 2: Run** `cd apps/api && bun test test/online-join.test.ts` — Expected: FAIL (404 on the route).
- [ ] **Step 3: Implement `POST /:id/join`** in the order: rate limit → room lookup (same campus, online, host not blocked) → cancelled → membership → time window → configured → `participants()` (any throw → 502, fail closed) → blocked-present check against blocks the caller placed → `ensureRoom(roomName(id), room.capacity)` → `issueToken({ room, identity: user.id, name: user.name, expiresAt: room.endsAt })`. Log nothing about the token.
- [ ] **Step 4: Run** `cd apps/api && bun test` — Expected: all PASS; `bun run typecheck`.
- [ ] **Step 5: Commit** `feat(api): join a live online room, with the block prompt`.

### Task 5: Removing people, cancelling, ending, suspending

**Files:**
- Create: `apps/api/src/roomsweep.ts`
- Modify: `apps/api/src/routes/rooms.ts` (add `POST /:id/members/:userId/remove`; `DELETE /:id` closes the call), `apps/api/src/server.ts` (start the sweep), the staff suspend route in `apps/api/src/admin/routes.ts` (call `removeFromLiveCalls`)
- Test: `apps/api/test/online-ending.test.ts`

**Interfaces:**
- Produces: `sweepEndedRooms(now?: Date): Promise<number>` (closes the LiveKit room of every online, non-cancelled room whose `endsAt` is within the last 15 minutes and returns how many it closed; closing is idempotent); `startRoomSweep(): void` (runs it every 60 s, logging errors); `removeFromLiveCalls(userId: string, now?: Date): Promise<void>` (removes the student from every online room that is live now and where they are approved).

- [ ] **Step 1: Write failing tests**: `the sweep closes the call of a room that has just ended and not one still live or ended long ago`; `the sweep survives LiveKit failing and reports the rest`; `the host can remove an approved member: status becomes declined, the member is disconnected, gets a room.decision declined event, capacity is freed`; `a removed member cannot join and cannot request again`; `the host cannot remove themselves (422)`, `a non-host gets 403 host_only`, `removing someone who is not approved is 404`; `cancelling an online room closes its call, and cancelling still succeeds if LiveKit fails`; `suspending a student removes them from live calls they are in`.
- [ ] **Step 2: Run** `cd apps/api && bun test test/online-ending.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the functions and routes; `removeParticipant` and `closeRoom` failures are caught and logged (never turn a cancel or a suspension into an error); wire `startRoomSweep()` in `server.ts` next to the existing interval.
- [ ] **Step 4: Run** `cd apps/api && bun test` — Expected: all PASS; `bun run typecheck`.
- [ ] **Step 5: Commit** `feat(api): end, cancel, remove and suspend close the live call`.

### Task 6: Web: creating, listing, joining and the call screen

**Files:**
- Modify: `apps/web/package.json` (add `livekit-client`, exact pinned version), `apps/web/src/routes/_app.rooms.tsx` (create form, list card, problem texts)
- Create: `apps/web/src/lib/voice.ts`, `apps/web/src/lib/voice.test.ts`, `apps/web/src/components/VoiceRoom.tsx`, `apps/web/src/components/BlockedPresentDialog.tsx`

**Interfaces:**
- Consumes: Tasks 3-5 API.
- Produces: `joinState(room: { startsAt: string; endsAt: string; cancelled: boolean }, now: Date): 'upcoming' | 'live' | 'ended'`; `blockedAmong(participantIds: string[], blockedIds: Set<string>): string[]`; `<VoiceRoom roomId title onLeave />` (connects via `api.rooms({ id }).join.post`, handles the 409 `blocked_present` by showing `BlockedPresentDialog` with "Join anyway" and "Not now", then connects with `acknowledgeBlocked: true`).

- [ ] **Step 1: Write the failing unit tests** in `voice.test.ts`: `joinState is upcoming before start, live at start, ended at end and when cancelled`; `blockedAmong returns only ids in the blocked set`.
- [ ] **Step 2: Run** `cd apps/web && bun run test src/lib/voice.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** `voice.ts` as above. Rooms page: a "Where" toggle (In person / Online) on the create form; Online hides the place field and, for a non-premium host, shows "Online rooms are a premium feature" and disables create (the API answer `premium_required` also maps to that text); problem texts for the new error codes; online cards show an "Online" tag instead of the place and a "Join voice" button for the host and approved members only while `joinState` is live. `VoiceRoom`: connect with `livekit-client` (microphone only), mute/unmute, participant list with a speaking indicator, a text box whose messages (sent over the data channel) exist only for people in the call, Leave, and clear states for "microphone blocked", "reconnecting" and "this room has ended"; during the call, a banner "Someone you blocked joined" (matching participant identities against the student's own block list from `GET /blocks`) with Leave and Stay.
- [ ] **Step 4: Run** the unit tests (PASS) and `bun run typecheck` (clean) in `apps/web`.
- [ ] **Step 5: Commit** `feat(web): online rooms, join voice and the call screen`.

### Task 7: End-to-end checks, docs and PR

**Files:**
- Modify: `apps/e2e/env.ts` / `apps/e2e/prepare.ts` (give the API fake `LIVEKIT_*` values so the UI treats LiveKit as configured; the e2e never connects to real audio), `apps/e2e/tests/student.spec.ts`, `README.md` (an "Online rooms" bullet and the three env vars), the PR template boxes as relevant

**Interfaces:**
- Consumes: everything above. A helper in `apps/e2e/tests/helpers.ts`: `makePremium(student: Student): Promise<void>` using `setPremium` from `apps/api/src/premium`.

- [ ] **Step 1: Write e2e tests**: `a premium host creates an online room and sees the Online tag` and `a non-premium host sees the premium message and cannot create one`; `an approved member sees "Join voice" while the room is live, and an unapproved student never does`; `an upcoming online room shows no Join voice button`.
- [ ] **Step 2: Run** `cd apps/e2e && bun run test` — Expected: the new tests PASS (written after the features exist, so also revert one UI condition temporarily to confirm the live-only test can fail, then restore it).
- [ ] **Step 3: Document** in `README.md`: online rooms, premium flag and `bun run admin premium <email> <days|off>`, the three env vars, that voice and chat are not recorded or stored, the block prompt behaviour, and the sweep.
- [ ] **Step 4: Run everything:** `bun run test`, `bun run typecheck`, `bun run db:check`, the web Vitest suite and the full e2e suite — Expected: all PASS.
- [ ] **Step 5: Commit** `test,docs: online rooms e2e checks and README`, push `feat/online-rooms` and open a PR (not to `main` directly).
