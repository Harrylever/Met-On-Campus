import { and, eq, or } from "drizzle-orm"
import { blocks, users } from "@moc/db"
import { db } from "./context"

/** Everyone `userId` should not see or reach: people they have blocked or been blocked by, plus suspended accounts. */
export async function blockedWith(userId: string): Promise<Set<string>> {
  const rows = await db
    .select()
    .from(blocks)
    .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)))
  const suspended = await db.select({ id: users.id }).from(users).where(eq(users.status, "suspended"))
  return new Set([
    ...rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)),
    ...suspended.map((s) => s.id),
  ])
}

export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const [gone] = await db.select({ id: users.id }).from(users).where(and(or(eq(users.id, a), eq(users.id, b)), eq(users.status, "suspended"))).limit(1)
  if (gone) return true // a suspended account behaves like a block in every direction
  const [row] = await db
    .select()
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1)
  return !!row
}
