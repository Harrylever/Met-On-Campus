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
