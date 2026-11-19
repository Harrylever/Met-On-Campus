# Admin push broadcast (design)

Size: small change. Status: awaiting approval.

## Intent and why
Staff want to nudge students from the admin panel: announcements, and pointers to a possible match or study
recommendation. Today every push is automatic and generic (invite, message, room, badge). There is no way for a person to
send a message. This adds a manual broadcast page to `apps/platform`.

## Goals
- A new admin page, "Announcements", where staff write a push notification and send it to students who have push on.
- Audience: all students, one campus, or one department within a campus.
- Before sending, show how many students and devices it will reach. Sending needs a confirm step.
- A history list: who sent what, when, to how many students, how many devices accepted it.
- Every send is written to the existing audit log.

## Non-goals
- No in-app notification inbox or bell. Students without push enabled receive nothing (option B, later).
- No scheduling, no automated or per-student recommendations (option C, later), no images, no opt-out categories.
- No "send a test to myself" (admins are not necessarily students).

## Anti-goals
- Must never become a spam cannon: no accidental double sends, no unlimited sending, no sending to suspended students.
- Must not open a way to push links outside the app (phishing). Links are in-app paths only.

## Approaches considered
- **A. Push-only broadcast panel (chosen).** Smallest piece that does what was asked ("users who have notifications enabled").
- B. A plus an in-app inbox: reaches everyone and persists, but about 2-3x the work (new table, API, student UI).
- C. B plus automated match/study nudges: a separate project with its own rules.

## Design (the how, mostly my calls)
- **Data:** one new table `push_broadcasts` (id, admin id, title, body, url, university nullable, department nullable,
  students, devices, delivered, created at). One drizzle migration (repo has `db:check` for this).
- **API** (`apps/api/src/admin/broadcasts.ts`, registered in `index.ts` beside the other admin routes, behind `adminAuthed`):
  - `GET /admin/broadcasts` returns history, plus the campus and department lists for the audience picker.
  - `POST /admin/broadcasts/preview` takes an audience and returns student and device counts. Counts only active students with at least one subscription.
  - `POST /admin/broadcasts` validates, rate limits, sends, records, audits.
- **Sending:** a new `broadcastPush()` in `push.ts` that reuses the existing sender, dead-device cleanup and endpoint
  allowlist. It uses `tag: 'broadcast'` and the admin's own title. It skips the 2-minute per-kind throttle and the
  "student is in the app" suppression, because there is no in-app copy of an announcement. It selects only
  `status = 'active'` students itself. It runs with limited concurrency so one send cannot flood the push services.
- **Limits (my calls):** title up to 50 characters, body up to 140. Link is optional, must start with `/` and not `//`,
  default `/discover`. At most 5 broadcasts per hour across staff (Redis counter, same pattern as `hit()` in `ratelimit.ts`).
  A repeat of the identical title, body and audience within 10 minutes is rejected, which covers double clicks.
- **Admin UI** (`apps/platform/src/app/(app)/announcements/`): a server-action form following the Departments page.
  Fields: title, message, link, audience (all / campus / campus + department). A live "reaches N students (M devices)" line,
  then a Send button that opens a confirm showing the exact text and count. History table below. Add "Announcements" to the
  sidebar in `layout.tsx` with an icon in `icons.tsx`.
- **Privacy note:** staff text appears on lock screens. The form says so, and it is the only place staff-typed text reaches a
  lock screen, so the form warns against names or personal details.

## Left to the builder
- Exact copy and styling of the page, the icon, and the migration name.
- Confirm `apps/web/public/sw.js` shows `payload.title` and `payload.url` as sent (the `Payload` type already carries both).
- Tests in `apps/api/test/` following `push.test.ts` (fake sender): audience filtering, suspended students excluded,
  dead-device cleanup, rate limit, duplicate rejection, auth required, bad links rejected.
