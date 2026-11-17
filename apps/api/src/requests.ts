import { and, desc, eq, or } from 'drizzle-orm'
import { connectionRequests } from '@moc/db'
import { db } from './context'

export type Req = typeof connectionRequests.$inferSelect

/**
 * The request that decides how two students stand in one mode. There can be two (A invited B, later B invited A after
 * a decline): an accepted one wins, otherwise the most recent.
 */
export function between(rows: Req[], a: string, b: string): Req | undefined {
  const mine = rows.filter((r) => (r.fromUserId === a && r.toUserId === b) || (r.fromUserId === b && r.toUserId === a))
  return mine.find((r) => r.status === 'accepted') ?? mine.sort((x, y) => +y.createdAt - +x.createdAt)[0]
}

export async function pairRequest(intent: Req['intent'], a: string, b: string) {
  const rows = await db.select().from(connectionRequests).where(and(
    eq(connectionRequests.intent, intent),
    or(and(eq(connectionRequests.fromUserId, a), eq(connectionRequests.toUserId, b)), and(eq(connectionRequests.fromUserId, b), eq(connectionRequests.toUserId, a))),
  )).orderBy(desc(connectionRequests.createdAt))
  return between(rows, a, b)
}
