import { redis } from './context'

// Per-minute request counters in Redis (2 day TTL). Cheap, restart-safe, and shared across replicas.
const minute = (t = Date.now()) => Math.floor(t / 60_000)
const k = (kind: string, m: number) => `metrics:${kind}:${m}`

export function recordRequest(status: number) {
  const m = minute()
  const kind = status >= 500 ? '5xx' : status >= 400 ? '4xx' : '2xx'
  void redis.multi()
    .incr(k('req', m)).expire(k('req', m), 172_800)
    .incr(k(kind, m)).expire(k(kind, m), 172_800)
    .exec().catch(() => {}) // metrics must never break a request
}

/** Last `minutes` minutes, oldest first. */
export async function recentRequests(minutes = 60) {
  const now = minute()
  const ms = Array.from({ length: minutes }, (_, i) => now - (minutes - 1 - i))
  const pipe = redis.pipeline()
  for (const m of ms) for (const kind of ['req', '4xx', '5xx']) pipe.get(k(kind, m))
  const res = (await pipe.exec()) ?? []
  return ms.map((m, i) => ({
    t: m * 60_000,
    requests: Number(res[i * 3]?.[1] ?? 0),
    clientErrors: Number(res[i * 3 + 1]?.[1] ?? 0),
    serverErrors: Number(res[i * 3 + 2]?.[1] ?? 0),
  }))
}
