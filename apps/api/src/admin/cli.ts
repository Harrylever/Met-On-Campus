// Staff account management. There is no public sign-up: this is the only way an account comes into being.
//   bun src/admin/cli.ts invite <email> [--reset]   prints a one-time setup link (valid 24h)
//   bun src/admin/cli.ts disable <email>            locks the account and ends its sessions
//   bun src/admin/cli.ts list
//   bun src/admin/cli.ts premium <email> <days|off>  grants premium for N days from now, or clears it
import { eq } from 'drizzle-orm'
import { adminSessions, adminUsers } from '@moc/db'
import { db } from '../context'
import { env } from '../env'
import { setPremium } from '../premium'
import { randomToken, sha256 } from './crypto'

const [cmd, rawEmail, flag] = process.argv.slice(2)
const email = rawEmail?.trim().toLowerCase()
const fail = (msg: string): never => { console.error(`error: ${msg}`); process.exit(1) }

if (cmd === 'invite') {
  if (!email) fail('usage: invite <email> [--reset]')
  // The allowlist is enforced here, at login, and on every request, so an invite alone is never enough.
  if (!env.adminEmails.includes(email!)) fail(`${email} is not in PLATFORM_ADMIN_EMAILS. Add it to the API's environment first.`)
  const [existing] = await db.select().from(adminUsers).where(eq(adminUsers.email, email!)).limit(1)
  if (existing?.totpEnabledAt && flag !== '--reset') fail('that account is already set up. Use --reset to replace its password and authenticator.')
  const token = randomToken(32)
  const reset = { passwordHash: null, totpSecretEnc: null, totpEnabledAt: null, backupCodeHashes: [] as string[], failedLogins: 0, lockedUntil: null, disabledAt: null }
  const setup = { setupTokenHash: sha256(token), setupExpiresAt: new Date(Date.now() + 24 * 3600_000) }
  if (existing) {
    await db.update(adminUsers).set({ ...setup, ...(flag === '--reset' ? reset : {}) }).where(eq(adminUsers.id, existing.id))
    if (flag === '--reset') await db.delete(adminSessions).where(eq(adminSessions.adminId, existing.id))
  } else {
    await db.insert(adminUsers).values({ email: email!, ...setup })
  }
  console.log(`\nSetup link for ${email} (valid 24 hours, single use):\n\n  ${env.platformUrl}/setup?token=${token}\n\nSend it over a private channel. It lets the holder choose the password and enrol an authenticator.\n`)
} else if (cmd === 'disable') {
  if (!email) fail('usage: disable <email>')
  const [a] = await db.update(adminUsers).set({ disabledAt: new Date() }).where(eq(adminUsers.email, email!)).returning()
  if (!a) fail('no such account')
  await db.delete(adminSessions).where(eq(adminSessions.adminId, a!.id))
  console.log(`disabled ${email} and ended its sessions`)
} else if (cmd === 'list') {
  const rows = await db.select().from(adminUsers)
  for (const a of rows) console.log(`${a.email}  ${a.disabledAt ? 'DISABLED' : a.totpEnabledAt ? 'active' : 'invited'}  last login: ${a.lastLoginAt?.toISOString() ?? 'never'}  allowlisted: ${env.adminEmails.includes(a.email)}`)
} else if (cmd === 'premium') {
  const days = flag === 'off' ? null : Number(flag)
  if (!email || (days !== null && (!Number.isFinite(days) || days <= 0))) fail('usage: premium <email> <days|off>')
  try {
    const until = await setPremium(email!, days)
    console.log(until ? `${email} is premium until ${until.toISOString()}` : `premium cleared for ${email}`)
  } catch (e) { fail((e as Error).message) }
} else {
  fail('commands: invite <email> [--reset] | disable <email> | list | premium <email> <days|off>')
}
process.exit(0)
