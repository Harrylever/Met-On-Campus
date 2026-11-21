import { and, eq } from 'drizzle-orm'
import { intentProfiles, NO_DEPARTMENT, users } from '@moc/db'
import { db } from './context'
import { isBlockedBetween } from './blocks'

export type Intent = 'study' | 'friends' | 'romance'
type User = typeof users.$inferSelect

/**
 * Romance only: two students are shown to each other when both set a gender and they differ, or when neither set one.
 * Someone who set a gender only ever sees, and is only ever seen by, the opposite gender, so a person with none set is
 * not shown to them (and cannot reach them) either. It is symmetric, so a Spark can never land with someone who should
 * not see the sender.
 */
export const genderCompatible = (a: { gender: 'male' | 'female' | null }, b: { gender: 'male' | 'female' | null }) =>
  (!a.gender && !b.gender) || (!!a.gender && !!b.gender && a.gender !== b.gender)

// Whether `me` and `other` may see each other in `intent`. Both must have the mode enabled.
// Romance is mutual opt-in and honours "hide from my department" on either side, and the gender rule above.
export async function canInteract(me: User, other: User, intent: Intent) {
  if (me.id === other.id || me.university !== other.university) return false
  if (await isBlockedBetween(me.id, other.id)) return false
  const rows = await db.select().from(intentProfiles)
    .where(and(eq(intentProfiles.intent, intent), eq(intentProfiles.enabled, true)))
    .then((r) => r.filter((p) => p.userId === me.id || p.userId === other.id))
  const mine = rows.find((p) => p.userId === me.id)
  const theirs = rows.find((p) => p.userId === other.id)
  if (!mine || !theirs) return false
  if (intent === 'romance' && !genderCompatible(me, other)) return false
  if (intent === 'romance' && me.department !== NO_DEPARTMENT && me.department === other.department && (mine.hideFromDepartment || theirs.hideFromDepartment)) return false
  return true
}

export const orderedPair = (a: string, b: string) => (a < b ? ([a, b] as const) : ([b, a] as const))
