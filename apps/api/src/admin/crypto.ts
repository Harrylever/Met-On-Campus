import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../env'

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

/** Constant-time string comparison (length differences leak nothing useful here: tokens are fixed length). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  if (ab.length !== bb.length) { timingSafeEqual(ab, ab); return false }
  return timingSafeEqual(ab, bb)
}

function key(): Buffer {
  if (env.adminEncryptionKey) {
    const k = Buffer.from(env.adminEncryptionKey, 'base64')
    if (k.length !== 32) throw new Error('ADMIN_ENCRYPTION_KEY must be 32 random bytes, base64-encoded')
    return k
  }
  if (env.isProd) throw new Error('ADMIN_ENCRYPTION_KEY is required in production')
  return createHash('sha256').update('moc-dev-only-admin-key').digest() // dev/test only
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')
}
export function decrypt(blob: string): string {
  const raw = Buffer.from(blob, 'base64')
  const d = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12))
  d.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
}

/** Ten single-use backup codes like "k3f9-a82m-x7qp". Returned once; only hashes are stored. */
export function newBackupCodes(n = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789' // no look-alikes
  const codes = Array.from({ length: n }, () => {
    const b = randomBytes(12)
    const chars = Array.from(b, (x) => alphabet[x % alphabet.length]).join('')
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`
  })
  return { codes, hashes: codes.map(hashBackupCode) }
}
export const normalizeBackupCode = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '')
export const hashBackupCode = (c: string) => sha256(`backup:${normalizeBackupCode(c)}`)
