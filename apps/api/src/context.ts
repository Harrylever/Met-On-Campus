import Redis from "ioredis"
import { createDb } from "@moc/db"
import { env } from "./env"

export const db = createDb(env.databaseUrl)
export const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 })

type Publisher = (topic: string, payload: unknown) => void
let publisher: Publisher = () => {}
// Taps see every event that is published (the WebSocket is one consumer; push notifications are another).
const taps: Publisher[] = []
export const bus = {
  attach(fn: Publisher) {
    publisher = fn
  },
  tap(fn: Publisher) {
    taps.push(fn)
  },
  publish(topic: string, payload: unknown) {
    publisher(topic, payload)
    for (const t of taps) {
      try { t(topic, payload) } catch (err) { console.error("[bus] tap failed", err) } // a consumer must never break the request
    }
  },
}
export const topics = {
  user: (id: string) => `user:${id}`,
  campus: (uni: string) => `campus:${uni}`,
}
