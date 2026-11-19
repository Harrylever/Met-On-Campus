// Gets the throwaway database ready: migrations applied, tables emptied, one open campus (FUTMinna, students must use
// st.futminna.edu.ng), and one staff account. Run by `bun run test` before Playwright starts the servers.
import { API_ENV, DATABASE_URL, STAFF } from './env'

Object.assign(process.env, API_ENV)
// These tests TRUNCATE tables and flush Redis. Never let them near a real database.
if (!/_e2e(\?|$)/.test(DATABASE_URL)) throw new Error(`Refusing to run against "${DATABASE_URL}". The database name must end in _e2e.`)

const { migrate } = await import('drizzle-orm/postgres-js/migrator')
const { sql } = await import('drizzle-orm')
const { adminUsers, campuses, campusSpots, DEFAULT_DEPARTMENTS, DEFAULT_SPOTS, departments } = await import('../../packages/db/src/index.ts')
const { db, redis } = await import('../api/src/context.ts')
const { encrypt, newBackupCodes } = await import('../api/src/admin/crypto.ts')

await migrate(db, { migrationsFolder: new URL('../../packages/db/drizzle', import.meta.url).pathname })
await db.execute(sql`truncate table users, email_codes, admin_users, admin_audit restart identity cascade`)
await db.execute(sql`truncate table departments, campus_spots, campuses, campus_interest, push_broadcasts`)
await db.insert(departments).values(DEFAULT_DEPARTMENTS.map((name, i) => ({ name, sortOrder: (i + 1) * 10 })))
await db.insert(campusSpots).values(DEFAULT_SPOTS.map((name, i) => ({ name, sortOrder: (i + 1) * 10 })))
await db.insert(campuses).values({ slug: 'futminna', name: 'FUTMinna', emailDomains: ['st.futminna.edu.ng'] })
await db.insert(departments).values(DEFAULT_DEPARTMENTS.map((name, i) => ({ name, university: 'futminna', sortOrder: (i + 1) * 10 })))
await db.insert(campusSpots).values(DEFAULT_SPOTS.map((name, i) => ({ name, university: 'futminna', sortOrder: (i + 1) * 10 })))
await redis.flushdb()

await db.insert(adminUsers).values({
  email: STAFF.email, passwordHash: await Bun.password.hash(STAFF.password, { algorithm: 'argon2id' }),
  totpSecretEnc: encrypt(STAFF.totpSecret), totpEnabledAt: new Date(), backupCodeHashes: newBackupCodes().hashes,
})
console.log('e2e database ready')
process.exit(0)
