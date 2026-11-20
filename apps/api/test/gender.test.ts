import { beforeEach, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { intentProfiles, users } from '@moc/db'
import { db } from '../src/context'
import { makeUser, resetAll } from './helpers'

beforeEach(resetAll)

describe('gender storage', () => {
  test('a new student has no gender and every profile shows it by default', async () => {
    const a = await makeUser('Amina', { modes: ['study', 'friends'] })
    const [u] = await db.select().from(users).where(eq(users.id, a.id))
    const profiles = await db.select().from(intentProfiles).where(eq(intentProfiles.userId, a.id))
    expect(u!.gender).toBeNull()
    expect(profiles).toHaveLength(2)
    for (const p of profiles) expect(p.showGender).toBe(true)
  })

  test('the database refuses any gender other than male or female', async () => {
    const a = await makeUser('Amina')
    await db.execute(sql`update users set gender = 'female' where id = ${a.id}`) // a valid value is accepted
    await expect(db.execute(sql`update users set gender = 'x' where id = ${a.id}`)).rejects.toThrow()
  })
})
