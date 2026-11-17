import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb } from './index'

const db = createDb()
await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname })
await db.$client.end()
console.log('migrations applied')
