# Volunteers Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public `/volunteers` page with three unpaid, FUTMinna-only roles and an application form that emails the owner through Resend.

**Architecture:** Shared `lib/volunteers.ts` (roles, validation, email rendering) used by a client `VolunteerForm` and a `POST /volunteers/apply` route handler that calls Resend over `fetch`. Page uses the existing `PageShell`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind tokens already in `apps/marketing`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-19-volunteers-page-design.md`

## Global Constraints

- Roles: exactly Graphic Designer, Video Content Creator, Campus Ambassador. No Developer role.
- Eligibility copy: "Open to current FUTMinna students" (top of page and at the form).
- Compensation copy: volunteer, unpaid, no guarantee of payment or financial compensation. Never imply pay, stipend, certificate or employment.
- No new npm dependencies; Resend via `fetch` to `https://api.resend.com/emails` with a timeout.
- Owner's address only from env `VOLUNTEER_INBOX_EMAIL`; never committed. Applicant data is not logged in production.
- Leave the CSP `form-action 'none'` as is: the form submits with `fetch` to the same origin (`connect-src 'self'` already allows it).
- The site has no test runner; verify with `npm run typecheck`, `npm run build`, and a script-level check of `lib/volunteers.ts` (Task 1).

## Review Focus

- HTML in applicant text (`<script>`, `<img onerror>`): must be escaped in the email HTML.
- Header injection: newlines in name/email must not reach the subject or `reply_to` unvalidated.
- Oversized body or fields over the length limits: reject with 400, no email sent.
- Honeypot filled or rate limit exceeded: pretend success (honeypot) / 429 (rate limit), no email sent.
- Resend failure or missing env in production: the form shows "email us at <contact>" and nothing is lost silently.
- Non-FUTMinna email (`gmail.com`, `evilfutminna.edu.ng`, `futminna.edu.ng.evil.com`): friendly rejection message. `st.futminna.edu.ng` must pass.
- Phone width (~360px) and dark mode for the page and form.

---

### Task 1: Shared roles, validation and email rendering

**Files:**
- Create: `apps/marketing/src/lib/volunteers.ts`
- Create: `apps/marketing/scripts/check-volunteers.ts` (throwaway-style assertion script, committed so the checks are repeatable; run with `bun`)

**Interfaces:**
- Produces:
  - `type RoleId = 'graphic-designer' | 'video-creator' | 'campus-ambassador'`
  - `type Role = { id: RoleId; title: string; tagline: string; doing: string[]; looking: string[] }` and `export const roles: Role[]` (copy per spec; three entries)
  - `type Application = { name: string; email: string; department: string; level: string; role: RoleId; experience: string; why: string; extra: string; website: string }` (`website` is the honeypot)
  - `validateApplication(input: unknown): { ok: true; value: Application } | { ok: false; error: string }`
  - `renderApplicationEmail(app: Application): { subject: string; text: string; html: string }`
- Email domain rule: domain must equal `futminna.edu.ng` or end with `.futminna.edu.ng` (so `a@st.futminna.edu.ng` passes; `a@gmail.com`, `a@evilfutminna.edu.ng` and `a@futminna.edu.ng.evil.com` fail). Constant: `FUTMINNA_DOMAIN = 'futminna.edu.ng'`.
- Limits: name 100, email 254, department 100, level 20, experience/why 2000, extra 2000; required: all except `extra`.

- [ ] **Step 1: Write `scripts/check-volunteers.ts`** asserting: a valid input passes and is trimmed; an unknown role fails; an over-long `why` fails; `website: 'x'` fails with a distinguishable error (`'spam'`); an email containing `\n` fails; `renderApplicationEmail` of `name: '<img src=x onerror=1>'` contains `&lt;img` in `html` and no raw `<img`; the subject contains no newline.
- [ ] **Step 2: Run `bun apps/marketing/scripts/check-volunteers.ts`.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement `lib/volunteers.ts`** to the interfaces above (plain string checks and a small `escapeHtml`; no libraries).
- [ ] **Step 4: Run the script again.** Expected: prints `ok` and exits 0.
- [ ] **Step 5: Commit** — `git add apps/marketing/src/lib/volunteers.ts apps/marketing/scripts/check-volunteers.ts && git commit -m "feat(marketing): volunteer roles, validation and email rendering"`

### Task 2: Apply endpoint

**Files:**
- Create: `apps/marketing/src/app/volunteers/apply/route.ts`
- Modify: `.env.example` (document `VOLUNTEER_INBOX_EMAIL`; `RESEND_API_KEY` and `EMAIL_FROM` already exist)

**Interfaces:**
- Consumes: `validateApplication`, `renderApplicationEmail` from `~/lib/volunteers`.
- Produces: `export async function POST(req: Request): Promise<Response>` returning `{ ok: true }` (200), `{ ok: false, error: string }` with 400 (invalid), 429 (rate limited) or 502/503 (delivery failed or not configured).

- [ ] **Step 1: Implement `POST`**: reject bodies over 20 KB; parse JSON; validate (honeypot hit returns 200 `{ ok: true }` without sending); per-IP limit of 5 requests per hour using an in-memory `Map` keyed by `x-forwarded-for` first value; send via `fetch` to Resend with `from` = `process.env.EMAIL_FROM`, `to` = `[process.env.VOLUNTEER_INBOX_EMAIL]`, `reply_to` = applicant email, `signal: AbortSignal.timeout(8000)`. When `RESEND_API_KEY` is unset and `NODE_ENV !== 'production'`, `console.log` the rendered subject and text instead of sending and return ok. In production with missing env, return 503.
- [ ] **Step 2: Verify** — run `npm run dev` in `apps/marketing`, then `curl -s -X POST localhost:3200/volunteers/apply -H 'content-type: application/json' -d '<valid JSON>'`. Expected: `{"ok":true}` and the application printed in the dev console. Repeat with an invalid role: expected 400. Repeat 6 times: expected 429 on the sixth.
- [ ] **Step 3: Commit** — `git add apps/marketing/src/app/volunteers/apply/route.ts .env.example && git commit -m "feat(marketing): volunteer application endpoint (Resend)"`

### Task 3: Page and form

**Files:**
- Create: `apps/marketing/src/app/volunteers/page.tsx`
- Create: `apps/marketing/src/components/VolunteerForm.tsx` (`'use client'`)

**Interfaces:**
- Consumes: `roles`, `RoleId` from `~/lib/volunteers`; `PageShell`; `site.contactEmail`; `POST /volunteers/apply` from Task 2.
- Produces: default-exported `Volunteers()` server component and `metadata` (title "Volunteer", canonical `/volunteers`); `VolunteerForm({ initialRole?: RoleId })`.

- [ ] **Step 1: Implement `VolunteerForm`**: labelled inputs per the spec's fields, role `<select>` that updates the "experience" and "why" labels ("What experience do you have as a {role}?", "Why do you want to volunteer as a {role}?"), a visually hidden honeypot `website` input with `tabIndex={-1}` and `autoComplete="off"`, a submit button disabled while sending, `aria-live` status region for success and error. On failure show the server's `error` or, for network and 5xx errors, "Something went wrong. Email us at {site.contactEmail} instead." Repeat "Open to current FUTMinna students. Volunteer role, no guarantee of payment." above the submit button.
- [ ] **Step 2: Implement `Volunteers()`**: `PageShell` (title "Volunteer with us."), notice block (eligibility + unpaid), role cards from `roles` with an "Apply for this role" anchor to `#apply` (`?role=` handled by the form reading `location.hash`-free state: simplest is a card button that sets the role through a small client wrapper, or plain links to `#apply` with the select left manual; choose the plain anchor), then `<section id="apply">` with the form.
- [ ] **Step 3: Verify** — `npm run typecheck` and `npm run build` in `apps/marketing`. Expected: both succeed and `/volunteers` is listed. Then in `npm run dev`, submit a valid application. Expected: success message and the dev console shows the application. Check 360px width and dark mode.
- [ ] **Step 4: Commit** — `git add apps/marketing/src/app/volunteers/page.tsx apps/marketing/src/components/VolunteerForm.tsx && git commit -m "feat(marketing): volunteers page and application form"`

### Task 4: Footer link and sitemap

**Files:**
- Modify: `apps/marketing/src/components/Footer.tsx` (Product list: add `<li><Link href="/volunteers">Volunteer</Link></li>`)
- Modify: `apps/marketing/src/app/sitemap.ts` (add `'/volunteers'` to `paths`)
- Modify: `apps/marketing/next.config.ts` (update the top comment: the site is no longer "no forms"; it has one same-origin JSON endpoint)

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Verify** — `npm run build`; `/sitemap.xml` lists `/volunteers`; the Footer link works.
- [ ] **Step 3: Commit** — `git add apps/marketing && git commit -m "feat(marketing): link volunteers page from footer and sitemap"`

## Before it goes live (manual, owner)
Set `RESEND_API_KEY`, `EMAIL_FROM` and `VOLUNTEER_INBOX_EMAIL` on the marketing service in Railway, then submit one real test application.
