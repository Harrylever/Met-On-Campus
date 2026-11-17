import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export * from './schema'
export { schema }

export function createDb(url = process.env.DATABASE_URL ?? 'postgres://localhost:5432/metoncampus_dev') {
  const client = postgres(url, { max: 10 })
  return Object.assign(drizzle(client, { schema }), { $client: client })
}
export type Db = ReturnType<typeof createDb>
