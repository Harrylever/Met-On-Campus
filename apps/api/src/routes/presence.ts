import { Elysia, t } from 'elysia'
import { authed } from '../auth'
import { bus, topics } from '../context'
import * as presence from '../presence'

export const presenceRoutes = new Elysia({ prefix: '/presence' }).use(authed)
  .get('/', async ({ user }) => ({ onCampusNow: await presence.count(user.university) }))
  .post('/', async ({ user, body }) => {
    const { joined } = await presence.beat(user.university, user.id, body.place)
    if (joined) bus.publish(topics.campus(user.university), { type: 'presence.count', count: await presence.count(user.university) })
    return { ok: true }
  }, { body: t.Object({ place: t.Optional(t.String({ maxLength: 80 })) }) })
  .delete('/', async ({ user }) => {
    await presence.leave(user.university, user.id)
    bus.publish(topics.campus(user.university), { type: 'presence.count', count: await presence.count(user.university) })
    return { ok: true }
  })
