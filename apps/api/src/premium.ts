import { eq } from 'drizzle-orm'
import { users } from '@moc/db'
import { db } from './context'

export const isPremium = (u: { premiumUntil: Date | null }, now = new Date()): boolean =>
  !!u.premiumUntil && u.premiumUntil.getTime() > now.getTime()

/** Grants premium for `days` days from now, or clears it when `days` is null. Returns the new premiumUntil. */
export async function setPremium(email: string, days: number | null): Promise<Date | null> {
  const premiumUntil = days === null ? null : new Date(Date.now() + days * 864e5)
  const [u] = await db.update(users).set({ premiumUntil }).where(eq(users.email, email.trim().toLowerCase())).returning({ id: users.id })
  if (!u) throw new Error('no such student')
  return premiumUntil
}
