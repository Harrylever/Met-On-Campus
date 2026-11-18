import { eq, sql } from 'drizzle-orm'
import { campuses, users } from '@moc/db'
import { db } from './context'

// The allowlist of universities. Only a campus in `campuses` with open = true can create new accounts. Pausing one stops new
// accounts only: existing students keep signing in. Each campus has its own department and spot lists; the rows with no
// campus are a template copied into a campus when staff open it.

/** The university part of the address: 2 to 40 lowercase letters, digits and single hyphens. */
export const validSlug = (s: string) => s.length >= 2 && s.length <= 40 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)

export async function campusOpen(slug: string) {
  const [row] = await db.select({ open: campuses.open }).from(campuses).where(eq(campuses.slug, slug)).limit(1)
  return !!row?.open
}

/** Can this address get a sign-in code? Anyone at an open campus, and anyone who already has an account (a paused campus keeps its students). */
export async function mayRequestCode(email: string, slug: string) {
  if (await campusOpen(slug)) return true
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  return !!existing
}

const MAX_INTEREST_ROWS = 5000
/**
 * Count one attempt from a university that is not open yet. Only the university name and a number are kept: no email, name or
 * IP. Junk names are ignored, and the table stops growing at 5,000 universities so nobody can fill it with made-up domains.
 */
export async function noteInterest(slug: string) {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return
  await db.execute(sql`
    insert into campus_interest (slug, attempts, last_at)
    select ${slug}, 1, now()
    where (select count(*) from campus_interest) < ${MAX_INTEREST_ROWS} or exists (select 1 from campus_interest where slug = ${slug})
    on conflict (slug) do update set attempts = campus_interest.attempts + 1, last_at = now()`)
}

/** Opens a campus. With `fromTemplate`, it starts with a copy of the template department and spot lists. Returns false if it already exists. */
export async function openCampus(slug: string, name: string, fromTemplate: boolean) {
  return db.transaction(async (tx) => {
    const made = await tx.insert(campuses).values({ slug, name }).onConflictDoNothing().returning({ slug: campuses.slug })
    if (made.length === 0) return false
    if (fromTemplate) {
      for (const table of ['departments', 'campus_spots']) {
        await tx.execute(sql`
          insert into ${sql.raw(table)} (name, university, active, sort_order)
          select t.name, ${slug}, t.active, t.sort_order from ${sql.raw(table)} t
          where t.university is null
            and not exists (select 1 from ${sql.raw(table)} x where x.university = ${slug} and lower(x.name) = lower(t.name))`)
      }
    }
    return true
  })
}
