# Optional gender on profiles and Discover cards (short design)

Status: awaiting approval. Nothing has been built.

## Intent and why
Names can be gender-neutral, and many students won't set a photo, so a Discover card gives no clear signal of who someone is. Add an optional gender field, shown on cards as an icon. Matters most in Romance, where photos stay hidden until a Spark is accepted.

## Goals
- A student can set gender to Male or Female, or leave it unset.
- Shown by default on their Discover cards when set; each mode can hide it.
- Shown as an icon, never as a "Male"/"Female" text label on the card.

## Non-goals / anti-goals
- No filtering or searching by gender in Discover (not asked for; can be added later).
- Never required: not at onboarding, not anywhere. Unset shows nothing, not a placeholder.
- No effect on matching, ranking or visibility rules.
- Anti-goal: leaking it where the student hid it, including the API response (hiding must be enforced server-side, not just in the UI).

## Approaches considered
- **A. One value on the user, with a per-mode "show it" switch** (chosen). Set once, each mode decides whether it appears.
- B. A separate value per mode: rejected, allows presenting different genders in different modes.
- C. Free text: rejected, icons cannot render it and it invites abuse.

## Design (my calls unless marked as yours)
- **Yours:** optional; shown by default; two icons (male, female) plus not set.
- **My call, data:** nullable `gender` on `users` (`'male' | 'female'`, null = not set); `showGender` boolean on `intent_profiles`, default true. One migration, no backfill (existing students are null, so nothing changes for them).
- **My call, API:** Discover cards return `gender` only when the person set it and that mode's `showGender` is true; otherwise the field is omitted. Editing goes through the existing profile endpoints, under the existing profile-edit rate limit.
- **My call, UI:** a gender chooser (Male / Female / Prefer not to say) and a "Show on my cards" toggle per mode on the Profile screen. The card shows a small SVG icon beside the name, in the surrounding text colour. Every icon has an accessible text label and a tooltip, and colour never carries the meaning alone.
- **My call, privacy:** deleting an account already removes the user row, so the value goes with it. Nothing about gender goes into push notifications, emails or logs.
- Tests: API unit tests that an unset value and a hidden toggle both omit the field, and that blocked/other-campus students are unaffected; one e2e check that the icon appears on a card after setting it.

## Left to the builder
Exact icon artwork, the placement and wording on the Profile screen, and the migration name.
