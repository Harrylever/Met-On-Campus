import Redis from "ioredis"
import { createDb } from "@moc/db"
import { env } from "./env"

export const db = createDb(env.databaseUrl)
export const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 })

type Publisher = (topic: string, payload: unknown) => void
let publisher: Publisher = () => {}
export const bus = {
  attach(fn: Publisher) {
    publisher = fn
  },
  publish(topic: string, payload: unknown) {
    publisher(topic, payload)
  },
}
export const topics = {
  user: (id: string) => `user:${id}`,
  campus: (uni: string) => `campus:${uni}`,
}
