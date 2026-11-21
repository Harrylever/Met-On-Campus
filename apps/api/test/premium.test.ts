import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { rooms, users } from '@moc/db'
import { db } from '../src/context'
import { isPremium, setPremium } from '../src/premium'
import { makeUser, resetAll } from './helpers'

beforeEach(resetAll)

describe('premium and room mode', () => {
  test('existing and new rooms default to physical', async () => {
    const host = await makeUser('Amina')
    const [r] = await db.insert(rooms).values({
      intent: 'study', hostId: host.id, university: 'futminna', tag: 'CSS 411', title: 'Revision', place: 'Library',
      startsAt: new Date(Date.now() + 36e5), endsAt: new Date(Date.now() + 72e5), capacity: 4,
    }).returning()
    const [row] = await db.select().from(rooms).where(eq(rooms.id, r!.id))
    expect(row!.mode).toBe('physical')
  })

  test('isPremium is false for null and past dates, true for a future date', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    expect(isPremium({ premiumUntil: null }, now)).toBe(false)
    expect(isPremium({ premiumUntil: new Date('2025-12-31T00:00:00Z') }, now)).toBe(false)
    expect(isPremium({ premiumUntil: new Date('2026-01-02T00:00:00Z') }, now)).toBe(true)
  })

  test('setPremium sets a date N days ahead and null clears it', async () => {
    const a = await makeUser('Amina')
    const until = await setPremium(a.email, 30)
    const expected = Date.now() + 30 * 864e5
    expect(Math.abs(until!.getTime() - expected)).toBeLessThan(5000)
    const [u] = await db.select().from(users).where(eq(users.id, a.id))
    expect(u!.premiumUntil!.getTime()).toBe(until!.getTime())
    expect(await setPremium(a.email, null)).toBeNull()
    const [u2] = await db.select().from(users).where(eq(users.id, a.id))
    expect(u2!.premiumUntil).toBeNull()
  })

  test('setPremium throws for an unknown email', async () => {
    await expect(setPremium('nobody@st.futminna.edu.ng', 5)).rejects.toThrow('no such student')
  })
})
