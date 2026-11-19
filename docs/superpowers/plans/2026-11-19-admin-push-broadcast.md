# Admin Push Broadcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can send a push notification to students with push enabled, from a new "Announcements" page in the admin panel.

**Architecture:** A `broadcastPush` function in `apps/api/src/push.ts` reuses the existing sender and dead-device cleanup. A new `/admin/broadcasts` Elysia route group (behind `adminAuthed`) previews, validates, rate limits, sends, records and audits. A new Next.js page in `apps/platform` follows the Departments page pattern (server actions through `adminApi`).

**Tech Stack:** Bun, Elysia, Drizzle (Postgres), Redis, web-push; Next.js (apps/platform); `bun test` with a fake push sender.

**Spec:** `docs/superpowers/specs/2026-11-19-admin-push-broadcast-design.md`

## Global Constraints

- Title up to 50 characters, message up to 140, after trimming. Both required.
- Link optional, must start with `/` and not `//`, default `/discover`.
- At most 5 broadcasts per hour across all staff; an identical title + message + link + audience within 10 minutes is rejected.
- Only `users.status = 'active'` students with at least one push subscription are recipients.
- Broadcasts skip the per-kind 2-minute throttle and the "student is in the app" suppression. Push payload `tag` is `'broadcast'`.
- Every send writes an `admin_audit` row with action `push.broadcast`.
- Any signed-in admin may send (no roles).
- Schema change needs a committed drizzle migration (`bun run db:generate`, checked by `bun run db:check`).
- Do not commit unless the user asks; the "Commit" steps below apply once they have said to commit.

## Review Focus

- A student with several devices counts as one student and N devices. (Task 1 test)
- A push service answering 410 removes that device and does not stop other devices or students; `delivered` counts only 2xx. (Task 1 test)
- A suspended student, or one who removed their device, is never sent to or counted. (Task 1 test)
- Links like `//evil.com`, `https://evil.com`, `/\evil.com`, `javascript:alert(1)` are rejected. (Task 2 test)
- Whitespace-only title or message, and 51-character title / 141-character message, are rejected. (Task 2 test)
- A department name with no matching students, or a department without a campus, gives a clear error instead of a silent zero-send. (Task 2 test)
- Double click: the second identical submit is rejected and does not use up the hourly limit. (Task 2 test)

---

### Task 1: `broadcastPush` and audience counting

**Files:**
- Modify: `apps/api/src/push.ts`
- Test: `apps/api/test/broadcast-push.test.ts`

**Interfaces:**
- Consumes: existing `pushSubscriptions`, `users`, `send` (module-level sender), `Payload`, `Sub`.
- Produces (exported from `push.ts`):
  - `type Audience = { university?: string | null; department?: string | null }`
  - `type BroadcastMessage = { title: string; body: string; url: string }`
  - `audienceCounts(a: Audience): Promise<{ students: number; devices: number }>`
  - `broadcastPush(a: Audience, msg: BroadcastMessage): Promise<{ students: number; devices: number; delivered: number }>`

- [ ] **Step 1: Write failing tests** in `broadcast-push.test.ts`, copying the setup from `push.test.ts` (`resetAll`, `setPushSender` fake recording `{ sub, payload }` and returning a settable status, `subscribe` helper). Tests:
  - `counts students once and devices per subscription` (one user with 2 devices + one with 1: `{ students: 2, devices: 3 }`)
  - `filters by campus and by department` (users at `futminna` and `unilag` via `makeUser(name, { university, department })`)
  - `excludes suspended students` (set `users.status = 'suspended'`; counts and sends both skip them)
  - `sends the admin's title, body, url with tag "broadcast"` (assert fake sender payload equals `{ title, body, url, tag: 'broadcast' }`)
  - `ignores the throttle and the in-app presence rule` (call twice in a row; mark user present via `presence`; both sends happen)
  - `a 410 removes that device only, a 500 is not delivered but keeps the device, others still go out` (assert `delivered` and remaining `pushSubscriptions` rows)
- [ ] **Step 2: Run** `cd apps/api && bun test test/broadcast-push.test.ts`. Expected: FAIL (`audienceCounts` / `broadcastPush` not exported).
- [ ] **Step 3: Implement.** Extract the per-subscription loop and dead-device cleanup from `pushToUser` into an internal `sendToSubs(subs, payload): Promise<number>` (returns delivered; behaviour unchanged, existing `push.test.ts` must still pass). Implement `audienceCounts` as one aggregate query joining `push_subscriptions` to `users` with `status = 'active'` plus optional `university` / `department` equality. `broadcastPush` returns zeros when `!pushEnabled`; otherwise loads the matching subscriptions and sends them in chunks of 10 through `sendToSubs`.
- [ ] **Step 4: Run** `bun test test/broadcast-push.test.ts test/push.test.ts`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(api): broadcastPush for admin announcements`

---

### Task 2: Admin API routes, table and migration

**Files:**
- Modify: `packages/db/src/schema.ts` (add `pushBroadcasts` after `pushSubscriptions`), `apps/api/src/index.ts` (register route group beside `adminDepartmentRequests`)
- Create: `apps/api/src/admin/broadcasts.ts`, new file in `packages/db/drizzle/` (generated)
- Test: `apps/api/test/admin-broadcasts.test.ts`

**Interfaces:**
- Consumes: `audienceCounts`, `broadcastPush`, `Audience` (Task 1); `adminAuthed`, `audit(adminId, action, { targetType, targetId, meta, ip })` from `./session`; `hit(key, limit, windowSec)` from `../ratelimit`; `redis` from `../context`.
- Produces: `pushBroadcasts` table: `id, adminId (uuid, nullable, no FK), title, body, url, university (text null), department (text null), students, devices, delivered (ints), createdAt`. Export `adminBroadcasts` (Elysia, prefix `/admin/broadcasts`):
  - `GET /` → `{ items: Broadcast[] (newest 30), campuses: { slug: string; name: string }[], departments: { name: string; university: string }[] }` (departments from the `departments` table where `active` and `university` not null).
  - `POST /preview` body `{ university?: string, department?: string }` → `{ students, devices }`.
  - `POST /` body `{ title, body, url?, university?, department? }` → `{ id, students, devices, delivered }`.
  - Errors (JSON `{ error }`): 503 `push_unavailable`; 422 `invalid_title`, `invalid_body`, `invalid_link`, `department_needs_campus`, `unknown_campus`, `no_recipients`; 409 `duplicate_broadcast`; 429 `too_many_broadcasts`.

- [ ] **Step 1: Write failing tests** in `admin-broadcasts.test.ts` (setup as `admin-data.test.ts`: `makeAdmin`, `adminLogin`, `adminCall(..., { session })`; fake sender as in Task 1):
  - `requires a staff session` (401 on all three routes without one)
  - `preview returns counts for all, a campus, and a department`
  - `sends, records a history row, and writes a push.broadcast audit row`
  - `rejects bad links` for `//evil.com`, `https://evil.com`, `/\evil.com`, `javascript:alert(1)`; accepts `/discover` and omitted (stored as `/discover`)
  - `rejects blank or over-long title and message` (whitespace-only, 51 and 141 chars; 50 and 140 accepted)
  - `department without campus is 422; unknown campus is 422; zero recipients is 422 and sends nothing`
  - `identical resend within 10 minutes is 409 and does not use the hourly limit` (after a duplicate, five different sends still succeed)
  - `the sixth send in an hour is 429`
  - `503 when push is not configured` (only if `pushEnabled` can be toggled in tests; otherwise skip this one and note it)
- [ ] **Step 2: Run** `bun test test/admin-broadcasts.test.ts`. Expected: FAIL (404s).
- [ ] **Step 3: Implement the table** in `schema.ts`, run `bun run db:generate` from the repo root, and confirm the new migration file contains only `CREATE TABLE "push_broadcasts"`.
- [ ] **Step 4: Implement `adminBroadcasts`.** Validate in this order: title/body (trimmed lengths), link, audience (campus must exist in `campuses`; department requires campus), then dedupe with `redis.set('bc:dup:' + sha256(JSON of title|body|url|university|department), '1', 'EX', 600, 'NX')`, then `hit('broadcast', 5, 3600)`. If rate limited, delete the dedupe key before returning 429. Then `audienceCounts`; 422 `no_recipients` when devices is 0 (also delete the dedupe key). Then `broadcastPush`, insert the history row, call `audit(admin.id, 'push.broadcast', { targetType: 'push_broadcast', targetId: id, meta: { title, university, department, students, devices, delivered }, ip })`. Register in `index.ts`.
- [ ] **Step 5: Run** `bun test test/admin-broadcasts.test.ts`, then the full `bun run test` and `bun run db:check` from the repo root. Expected: all PASS, `db:check` clean.
- [ ] **Step 6: Commit** `feat(api): admin broadcast routes and history table`

---

### Task 3: Announcements page in the admin panel

**Files:**
- Create: `apps/platform/src/app/(app)/announcements/page.tsx`, `.../announcements/actions.ts`, `.../announcements/BroadcastForm.tsx`
- Modify: `apps/platform/src/app/(app)/layout.tsx` (nav item after Departments: `{ href: '/announcements', label: 'Announcements', icon: 'announce' }`), `apps/platform/src/components/icons.tsx` (add an `announce` icon, a megaphone or bell, same 24px stroke style)

**Interfaces:**
- Consumes: `adminData('/admin/broadcasts')`, `adminApi` (`~/lib/admin-api`); API contract from Task 2.
- Produces: server actions `previewAudience(university: string, department: string): Promise<{ students?: number; devices?: number; error?: string }>` and `sendBroadcast(input: { title: string; body: string; url: string; university: string; department: string }): Promise<{ error?: string; delivered?: number; students?: number }>`. Both re-check arguments (server actions are public), map API error codes to plain messages in a `MESSAGES` record like `lists/actions.ts`, and `revalidatePath('/announcements')` after a send.

- [ ] **Step 1: Implement `actions.ts`** with the two actions and messages for every error code listed in Task 2.
- [ ] **Step 2: Implement `BroadcastForm.tsx`** (client component, controlled fields as in `ListManager.tsx`): title, message (with live character counters 50 / 140), link, campus select ("All campuses" + one per campus), department select (shown only when a campus is chosen, filtered to that campus, "All departments" first). A live line "Reaches N students (M devices)" that calls `previewAudience` when the audience changes. A Send button opens an inline confirm showing the exact title, message, link, audience and count, with Confirm and Cancel. A short note: "This text can appear on lock screens. Do not include names or personal details." On success show "Sent to N students (M devices)" and clear the form.
- [ ] **Step 3: Implement `page.tsx`**: heading and one-line description in the Departments page style, the form, then a history table (When, Title, Audience, Students, Devices, Delivered) with an empty state.
- [ ] **Step 4: Add the sidebar item and icon.**
- [ ] **Step 5: Verify.** `bun run typecheck` from the repo root: no errors. Then run the API and platform apps (use the `run` skill), sign in as staff, and check: the count updates when changing campus; Send shows the confirm; sending with a fake or real subscribed browser shows the history row; the audit log page shows a `push.broadcast` entry; the page works at phone width.
- [ ] **Step 6: Commit** `feat(platform): Announcements page for push broadcasts`

---

## Self-review notes
- Spec coverage: audience (T1, T2, T3), counts before send and confirm (T2 preview, T3), history (T2 GET, T3), audit (T2), limits and dedupe (T2), active-only (T1), link rule (T2), skip throttle/presence (T1), lock-screen warning (T3), service worker check below.
- Service worker: `apps/web/public/sw.js` already shows `data.title`, `data.body`, `data.tag`, and opens `data.url` only on our own origin, so no change is needed. Because the tag is always `'broadcast'`, a newer broadcast replaces an older unread one on the device. This is intended.
