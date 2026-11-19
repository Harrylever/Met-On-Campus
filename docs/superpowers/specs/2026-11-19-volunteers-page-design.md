# Volunteers page (marketing site) — design

**Size:** small change. Role list approved in conversation 2026-11-19 (Developer role removed). Application form added at the owner's request the same day; this revision is awaiting approval.

## Intent
Recruit volunteers for Met On Campus through a public `/volunteers` page on `apps/marketing`, with an on-site application form whose submissions are emailed to the owner via Resend.

## Goals
- Present three roles clearly: Graphic Designer, Video Content Creator, Campus Ambassador.
- State up front, and again at the form, that roles are open to **current FUTMinna students only**.
- State plainly that the roles are **volunteer, unpaid, with no guarantee of payment or financial compensation**.
- An application form that emails the owner. Fields: Full name, Email, Department, Level, Role (select), "What experience do you have as a [role]?", "Why do you want to volunteer as a [role]?", "Anything else we should know?".

## Non-goals / anti-goals
- No promise, hint or implication of pay, stipend, certificate or future employment.
- No database and no new npm dependencies (Resend is called over `fetch`, as `apps/api/src/email.ts` does).
- Applicant data is not stored on our servers or logged; it only goes to the owner's inbox via Resend.
- The owner's personal address is never committed: it lives in an env var.

## Approaches
1. **Page + Next.js route handler `POST /volunteers/apply` that sends one email through Resend (chosen).** The marketing app already runs as a Node server (`next start`), so a route handler needs no new infrastructure. Trade-off: the static, no-forms site gains one small server endpoint, so it needs validation and spam protection.
2. `mailto:` links only. Zero backend, but the owner asked for a form, and `mailto:` fails for people without a mail app.
3. Forward through `apps/api`. Reuses its email code but couples the marketing site to the API and adds a public unauthenticated endpoint there. Rejected.

## Design
- `apps/marketing/src/app/volunteers/page.tsx`: lede, eligibility + unpaid notice, three role cards (what you'll do / what we're looking for), then the form. Each card's "Apply" button scrolls to the form with that role preselected.
- `apps/marketing/src/components/VolunteerForm.tsx` (client component): controlled fields, submits JSON with `fetch`, shows sending / success / error states. It does not use a native form action, because the site's CSP has `form-action 'none'`, which stays as is.
- `apps/marketing/src/lib/volunteers.ts`: the `roles` data, `validateApplication(input)` (trim, length limits, email format, role must be one of the three, honeypot empty) and `renderApplicationEmail(app)` (subject `Volunteer application: <Role> - <Name>`, plain text and escaped HTML).
- `apps/marketing/src/app/volunteers/apply/route.ts`: `POST` handler. Validates, rate-limits per IP (in-memory, small window), calls Resend with `reply_to` set to the applicant, and returns `{ ok: true }` or a clear error. Never echoes internals.
- Env (server only, documented in `.env.example`): `RESEND_API_KEY`, `VOLUNTEER_INBOX_EMAIL` (the owner's address), `EMAIL_FROM` (existing verified sender). If the key or inbox is unset: dev logs the application to the console; production returns an error and the page says to email `site.contactEmail` instead.
- Applicant email check: must look like an email and be a FUTMinna address (see "Decided" below).
- Footer link and sitemap entry. No Header item.

## Decided: FUTMinna email required
The form only accepts an email whose domain is `futminna.edu.ng` or ends with `.futminna.edu.ng` (students use subdomains such as `st.futminna.edu.ng`). Other domains get a friendly rejection message. Decided by the owner on 2026-11-19. The suffix lives in one constant in `lib/volunteers.ts`.

## Left to the builder
Exact wording polish, styling with existing tokens (`container-x`, `text-ink-2`, `btn`), responsive behaviour, accessible labels and error messages.
