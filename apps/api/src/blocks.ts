import { and, eq, or } from 'drizzle-orm'
import { blocks } from '@moc/db'
import { db } from './context'

/** Everyone `userId` has blocked or been blocked by. Blocks are symmetric in effect. */
export async function blockedWith(userId: string): Promise<Set<string>> {
  const rows = await db.select().from(blocks).where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)))
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)))
}

export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const [row] = await db.select().from(blocks).where(or(
    and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
    and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
  )).limit(1)
  return !!row
}
