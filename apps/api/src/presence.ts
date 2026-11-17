import { redis } from './context'
import { env } from './env'

// "On Campus Now" is ephemeral. Two Redis structures per campus:
//  - presence:idx:{uni}      ZSET member=userId score=expiry(ms)   -> cheap "who is here" listing
//  - presence:u:{uni}:{id}   STRING (place) with EX ttl           -> real TTL, auto-evicted
// Clients heartbeat (WS ping); stop heartbeating and the user falls off within the TTL.
const idx = (uni: string) => `presence:idx:${uni}`
const key = (uni: string, id: string) => `presence:u:${uni}:${id}`
export const knownCampuses = new Set<string>()

export async function beat(uni: string, userId: string, place = '') {
  knownCampuses.add(uni)
  const now = Date.now()
  const wasHere = await redis.exists(key(uni, userId))
  await redis.multi()
    .set(key(uni, userId), place, 'EX', env.presenceTtl)
    .zadd(idx(uni), now + env.presenceTtl * 1000, userId)
    .exec()
  return { joined: !wasHere }
}

export async function leave(uni: string, userId: string) {
  await redis.multi().del(key(uni, userId)).zrem(idx(uni), userId).exec()
}

export async function sweep(uni: string) {
  return redis.zremrangebyscore(idx(uni), '-inf', Date.now())
}

export async function here(uni: string): Promise<string[]> {
  await sweep(uni)
  return redis.zrangebyscore(idx(uni), Date.now(), '+inf')
}

export async function count(uni: string) {
  await sweep(uni)
  return redis.zcount(idx(uni), Date.now(), '+inf')
}

export async function placeOf(uni: string, id: string) {
  return redis.get(key(uni, id))
}
