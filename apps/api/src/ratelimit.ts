import { redis } from './context'

/** Fixed-window limiter in Redis. Returns seconds to wait when over the limit, else 0. */
export async function hit(key: string, limit: number, windowSec: number): Promise<number> {
  const k = `rl:${key}`
  const n = await redis.incr(k)
  if (n === 1) await redis.expire(k, windowSec)
  if (n <= limit) return 0
  const ttl = await redis.ttl(k)
  if (ttl < 0) await redis.expire(k, windowSec) // never leave a counter without a TTL
  return Math.max(ttl, 1)
}

// ---- Per-student limits on everything a person can do repeatedly ---------------------------------------------------
// Keyed by the signed-in student, never by IP: whole campuses share one Wi-Fi address, so a per-IP limit would punish real
// people. Numbers are generous for normal use and stop scripts and floods. Each rule may have several windows (a burst limit
// and a daily one); `window` is in seconds.
export const LIMITS = {
  invite: [{ limit: 10, window: 600 }, { limit: 40, window: 86_400 }],     // each one notifies someone
  message: [{ limit: 30, window: 60 }, { limit: 600, window: 3600 }],
  meetup: [{ limit: 10, window: 3600 }],                                    // proposals, on top of "message"
  roomCreate: [{ limit: 5, window: 3600 }, { limit: 15, window: 86_400 }],
  roomRequest: [{ limit: 20, window: 3600 }],
  roomJoin: [{ limit: 30, window: 3600 }],
  roomEdit: [{ limit: 20, window: 3600 }],                                  // each edit notifies every member
  discover: [{ limit: 60, window: 60 }],                                    // stops scraping the campus list
  profile: [{ limit: 30, window: 3600 }],
  checkin: [{ limit: 20, window: 3600 }],
  heartbeat: [{ limit: 30, window: 60 }],                                   // "on campus now"; the app sends 2 a minute
  block: [{ limit: 60, window: 3600 }],
  global: [{ limit: 600, window: 60 }],                                     // safety net for every signed-in request
} as const
export type LimitName = keyof typeof LIMITS

/**
 * Seconds this student must wait, or 0 if they may go ahead. If Redis fails the request is let through (and logged): a limiter
 * hiccup must never take the app down.
 */
export async function throttle(userId: string, name: LimitName): Promise<number> {
  try {
    for (const { limit, window } of LIMITS[name]) {
      const wait = await hit(`rate:${userId}:${name}:${window}`, limit, window)
      if (wait) return wait
    }
    return 0
  } catch (err) {
    console.error('[ratelimit] could not check, letting the request through:', name, (err as Error).message)
    return 0
  }
}

type SetLike = { headers: Record<string, string | number | undefined> }
/** The 429 body to return (and the Retry-After header set) when the student is over a limit, else null. */
export async function limited(userId: string, name: LimitName, set: SetLike) {
  const wait = await throttle(userId, name)
  if (!wait) return null
  set.headers['retry-after'] = String(wait)
  return { error: 'too_many_requests' as const, retryAfter: wait }
}
