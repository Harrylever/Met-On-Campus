import { and, eq } from 'drizzle-orm'
import { intentProfiles, users } from '@moc/db'
import { db } from './context'

export type Intent = 'study' | 'friends' | 'romance'
type User = typeof users.$inferSelect

// Whether `me` and `other` may see each other in `intent`. Both must have the mode enabled.
// Romance is mutual opt-in and honours "hide from my department" on either side.
export async function canInteract(me: User, other: User, intent: Intent) {
  if (me.id === other.id || me.university !== other.university) return false
  const rows = await db.select().from(intentProfiles)
    .where(and(eq(intentProfiles.intent, intent), eq(intentProfiles.enabled, true)))
    .then((r) => r.filter((p) => p.userId === me.id || p.userId === other.id))
  const mine = rows.find((p) => p.userId === me.id)
  const theirs = rows.find((p) => p.userId === other.id)
  if (!mine || !theirs) return false
  if (intent === 'romance' && me.department === other.department && (mine.hideFromDepartment || theirs.hideFromDepartment)) return false
  return true
}

export const orderedPair = (a: string, b: string) => (a < b ? ([a, b] as const) : ([b, a] as const))
