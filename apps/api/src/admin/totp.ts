import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// RFC 4226 / 6238 (SHA-1, 6 digits, 30s steps), which every authenticator app supports.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Uint8Array): string {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error('invalid base32')
    value = (value << 5) | i; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

export const newTotpSecret = () => base32Encode(randomBytes(20))

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', secret).update(msg).digest()
  const o = h[h.length - 1]! & 0xf
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!
  return String(bin % 10 ** digits).padStart(digits, '0')
}

/** Returns the matching time step (for replay protection) or null. Accepts +-`window` steps of clock drift. */
export function verifyTotp(secretBase32: string, code: string, now = Date.now(), window = 1, step = 30, digits = 6): number | null {
  if (!/^\d+$/.test(code) || code.length !== digits) return null
  const secret = base32Decode(secretBase32)
  const counter = Math.floor(now / 1000 / step)
  let match: number | null = null
  for (let w = -window; w <= window; w++) {
    const expected = Buffer.from(hotp(secret, counter + w, digits))
    // No early exit: every window is compared so timing does not reveal which one matched.
    if (timingSafeEqual(expected, Buffer.from(code)) && match === null) match = counter + w
  }
  return match
}

export const otpauthUri = (email: string, secretBase32: string, issuer = 'Met On Campus Platform') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
