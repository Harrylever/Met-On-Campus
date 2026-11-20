# Optional Profile Gender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student optionally set male or female on their profile and have it show as an icon on their Discover cards, with a per-mode switch to hide it.

**Architecture:** A nullable `gender` column on `users` and a `show_gender` boolean (default true) on `intent_profiles`. The Discover API includes `gender` on a card only when the value is set and that mode's switch is on; otherwise the key is absent. The web app adds a chooser to "About you", a toggle to each mode form, and an icon beside the name on cards.

**Tech Stack:** Bun, Elysia, Drizzle (Postgres), React (TanStack Start), bun:test, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-profile-gender-design.md`

## Global Constraints

- Gender is optional everywhere: never required at onboarding, never a blocker to saving anything else.
- Values are exactly `'male' | 'female'`, or null for not set. No free text, no other values.
- Shown as an icon on cards, never as a "Male"/"Female" text label on the card. Every icon has an accessible text label and a tooltip; colour never carries the meaning alone.
- Hidden or unset means the `gender` key is absent from the Discover card JSON, not `null`.
- Gender never appears in push notifications, emails, or logs.
- No filtering or searching by gender (the Discover `q` search must not match it).
- Edits use the existing `profile` rate limit (`limited(user.id, "profile", set)`); do not add a new limit.
- Schema changes need a committed migration (`bun run db:generate`; CI runs `bun run db:check`).
- `main` rejects direct pushes: work on a branch `feat/profile-gender` and open a PR.
- Commit messages end with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Student changes gender from set to not set: their card loses the icon without a reload (Discover queries are invalidated after saving). Test: e2e step in Task 4.
- Gender set but a mode's switch is off: the response must not contain the word `gender` at all for that card. Test: Task 2.
- Gender unset and switch on: no empty icon, gap or "undefined" on the card. Test: Task 3 (unit) and Task 2 (key absent).
- Someone sending `gender` to `PUT /me/profiles/:intent` (wrong endpoint) or an unlisted value like `"other"` to `PATCH /me`: refused, nothing stored. Test: Task 2.
- Existing students after the migration: gender null, and every existing profile row has `show_gender` true. Test: Task 1.

---

### Task 1: Schema and migration

**Files:**
- Modify: `packages/db/src/schema.ts` (`users` ~line 25-47, `intentProfiles` ~line 64-75)
- Create: `packages/db/drizzle/00NN_*.sql` (generated)
- Test: `apps/api/test/gender.test.ts` (created here, extended in Task 2)

**Interfaces:**
- Produces: `users.gender: 'male' | 'female' | null` (column `gender`, text with a check constraint `gender_values`); `intentProfiles.showGender: boolean` (column `show_gender`, not null, default true).

- [ ] **Step 1: Write the failing test** in `apps/api/test/gender.test.ts`, using `resetAll` and `makeUser` from `./helpers` like `visibility.test.ts`:
  - `test('a new student has no gender and every profile shows it by default')`: create a student with modes `['study','friends']`, read `users` and `intent_profiles` rows via `db`, assert `gender` is `null` and each profile's `showGender === true`.
  - `test('the database refuses any gender other than male or female')`: updating a user's `gender` to `'x'` rejects.

- [ ] **Step 2: Run it** — `cd apps/api && bun test test/gender.test.ts` — expect FAIL (column does not exist).

- [ ] **Step 3: Edit `schema.ts`.** Add `gender: text('gender')` to `users` with `check('gender_values', sql`${t.gender} in ('male','female')`)` appended to its existing checks array (null passes a check), and `showGender: boolean('show_gender').notNull().default(true)` to `intentProfiles`. Run `bun run db:generate` and commit the generated SQL.

- [ ] **Step 4: Run** `bun run test:setup && cd apps/api && bun test test/gender.test.ts` — expect PASS; then `bun run db:check` — expect exit 0.

- [ ] **Step 5: Commit** `feat(db): optional gender on users, show_gender on profiles`.

### Task 2: API: set, hide, and serve gender

**Files:**
- Modify: `apps/api/src/routes/me.ts` (`ProfileBody` ~line 16-24, `.patch` body ~line 64-69), `apps/api/src/auth.ts:230` (`publicSelf`), `apps/api/src/routes/discover.ts` (card `.map`)
- Modify: `apps/api/test/helpers.ts` (`makeUser` accepts `gender?: 'male' | 'female'` and `showGender?: boolean`, applied to the user and every profile it creates)
- Test: `apps/api/test/gender.test.ts`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: `PATCH /me` accepts `gender: 'male' | 'female' | null`; `PUT /me/profiles/:intent` accepts `showGender: boolean`; `publicSelf(u)` includes `gender: 'male' | 'female' | null`; Discover cards include `gender: 'male' | 'female'` only when set and `showGender` is true.

- [ ] **Step 1: Write failing tests** (all in `gender.test.ts`, calling the API via `call(user, method, path, body)`):
  - `shows gender on the card by default once set`: viewer fetches `/discover?intent=study`; the card for a student made with `gender: 'female'` has `gender === 'female'`.
  - `omits the gender key when not set`: card JSON for a student with no gender has no `gender` key (`'gender' in card` is false).
  - `omits it when that mode's switch is off, without leaking it`: student has gender set and `showGender: false` in study; the study card's JSON string does not contain `gender`.
  - `the switch is per mode`: same student hides in study but not friends; friends card still has `gender`.
  - `PATCH /me sets and clears gender`: body `{ gender: 'male' }` returns 200 and `user.gender === 'male'`; body `{ gender: null }` clears it.
  - `PATCH /me refuses other values`: `{ gender: 'other' }` returns 422 and the stored value is unchanged.
  - `PUT /me/profiles/study ignores gender`: sending `{ gender: 'male' }` there is rejected (422) and stores nothing.
  - `PUT /me/profiles/:intent saves showGender`.
  - `blocked and other-campus students never appear, gender or not`: reuse the setup from `visibility.test.ts` with genders set.
  - `search does not match gender`: `/discover?intent=study&q=female` returns no card for a female student whose name, bio and tags don't contain it.

- [ ] **Step 2: Run** `cd apps/api && bun test test/gender.test.ts` — expect FAIL.

- [ ] **Step 3: Implement.** `PATCH /me` body adds `gender: t.Optional(t.Union([t.Literal('male'), t.Literal('female'), t.Null()]))` (it already writes `changes` straight to `users`). `ProfileBody` adds `showGender: t.Optional(t.Boolean())`. `publicSelf` adds `gender: u.gender`. In `discover.ts`, build the card with `...(u.gender && p.showGender ? { gender: u.gender } : {})`. Make sure unknown keys such as `gender` on the PUT body are rejected (Elysia's object validation: check whether `additionalProperties` needs setting to make the 422 test pass; set `t.Object({...}, { additionalProperties: false })` on `ProfileBody` only if it does).

- [ ] **Step 4: Run** `cd apps/api && bun test` — expect all PASS, including the existing suites. Run `bun run typecheck`.

- [ ] **Step 5: Commit** `feat(api): optional gender with per-mode visibility on Discover cards`.

### Task 3: Web: icon, chooser, toggle, card

**Files:**
- Create: `apps/web/src/lib/gender.ts` (`export type Gender = 'male' | 'female'`; `export function genderLabel(g: Gender | null | undefined): string | null` returns `'Male'`, `'Female'`, or `null`)
- Create: `apps/web/src/lib/gender.test.ts` (Vitest, same style as `name.test.ts`)
- Create: `apps/web/src/components/GenderIcon.tsx` (`export function GenderIcon({ gender }: { gender?: Gender | null })`)
- Modify: `apps/web/src/routes/_app.profile.tsx` ("About you" section ~line 44-68 and `ModeForm` ~line 99-150)
- Modify: `apps/web/src/routes/_app.discover.tsx` (card title ~line 112)

**Interfaces:**
- Consumes: Task 2 API (`gender` on `me.user` and on cards, `showGender` on profiles).
- Produces: `GenderIcon` renders nothing when `gender` is null/undefined; otherwise an inline SVG with `role="img"`, `aria-label` and `<title>` equal to `genderLabel(gender)`, drawn in `currentColor` with shapes that differ by symbol (♀ circle with a cross, ♂ circle with an arrow), so colour is never the only difference.

- [ ] **Step 1: Write the failing test** in `gender.test.ts`: `genderLabel('male') === 'Male'`, `genderLabel('female') === 'Female'`, `genderLabel(null) === null`, `genderLabel(undefined) === null`.

- [ ] **Step 2: Run** `cd apps/web && bun run vitest run src/lib/gender.test.ts` (use the web app's existing test script if different) — expect FAIL.

- [ ] **Step 3: Implement the three files and edits.**
  - `lib/gender.ts` and `GenderIcon.tsx` as in Interfaces.
  - Profile "About you": a labelled `<select>` "Gender (optional)" with options `Prefer not to say` (value ``), `Male`, `Female`; include it in `saveBasics` as `gender: gender || null`, and include it in the unsaved-changes check next to name/department/level. On success also call `qc.invalidateQueries({ queryKey: ['discover'] })` in addition to `router.invalidate()` so cards refresh.
  - `ModeForm`: a switch "Show my gender on my cards" (same pattern as the `enabled` switch), default from `profile?.showGender ?? true`, added to `snapshot` and to the `put` body as `showGender`. Render it only when the student has a gender set (read from the page's `me.user.gender`), with helper text "Only shown if you set it in About you."
  - Discover card: `<h2>` becomes `{s.name} <GenderIcon gender={s.gender} /> • {s.level}L {deptLabel(s.department)}` with a small gap and no extra space when `gender` is absent.

- [ ] **Step 4: Run** the unit test (PASS), then `bun run typecheck`.

- [ ] **Step 5: Commit** `feat(web): gender chooser, per-mode toggle and card icon`.

### Task 4: End-to-end check and docs

**Files:**
- Modify: `apps/e2e/tests/student.spec.ts` (add one test, reusing the existing two-student helpers in `apps/e2e/tests/helpers.ts`)
- Modify: `README.md` (one bullet near the **Discover** and **Blocking** notes, ~line 90-109)

**Interfaces:**
- Consumes: Tasks 2-3.

- [ ] **Step 1: Write the e2e test** `a student's gender icon appears on their card, and disappears when they clear it`: student A sets Female on Profile and saves; student B opens Discover and sees an element with role `img` and name `Female` on A's card; A sets "Prefer not to say" and saves; after B reloads (or the feed refetches), the icon is gone.

- [ ] **Step 2: Run** `cd apps/e2e && bunx playwright test student.spec.ts -g gender` — expect FAIL before Tasks 2-3 are merged in the branch, PASS after. (If run last, it should pass first time; run once to confirm it passes and again with the UI change reverted locally to confirm the test can fail.)

- [ ] **Step 3: Add the README bullet:** gender is optional (male, female or unset), shown as an icon on Discover cards, with a per-mode switch; hidden or unset means the field is absent from the API response; it is never used for matching, filtering or search.

- [ ] **Step 4: Run everything:** `bun run test`, `bun run typecheck`, `bun run db:check`, the web Vitest suite, and the full e2e suite — expect all PASS.

- [ ] **Step 5: Commit** `test,docs: gender icon e2e check and README`, push `feat/profile-gender`, and open a PR (not to `main` directly).
