import { Elysia, t } from 'elysia'
import { authed } from './auth'
import { bus, topics } from './context'
import * as presence from './presence'
import { throttle } from './ratelimit'

// Native Elysia WebSocket. `authed` resolves the session cookie before the upgrade (401 otherwise),
// so `ws.data.user` is available in every event. Then:
//  - subscribe to the user's private topic and their campus topic
//  - treat {type:"presence",place?} frames as "On Campus Now" heartbeats
export const wsRoutes = new Elysia().use(authed).ws('/ws', {
  body: t.Object({ type: t.Literal('presence'), place: t.Optional(t.String({ maxLength: 80 })) }),
  async open(ws) {
    const { user } = ws.data
    ws.subscribe(topics.user(user.id))
    ws.subscribe(topics.campus(user.university))
    ws.send({ type: 'ready', onCampusNow: await presence.count(user.university) })
  },
  async message(ws, msg) { await onPresenceFrame(ws.data.user, msg.place) },
})

/** An "on campus now" heartbeat. The app sends two a minute; past 30 a minute they are ignored (a socket has no 429 to send). */
export async function onPresenceFrame(user: { id: string; university: string }, place?: string) {
  if (await throttle(user.id, 'heartbeat')) return
  const { joined } = await presence.beat(user.university, user.id, place)
  if (joined) bus.publish(topics.campus(user.university), { type: 'presence.count', count: await presence.count(user.university) })
}
