import { app } from './index'
import { env } from './env'
import { bus, topics } from './context'
import * as presence from './presence'
import { assertEmailConfigured } from './email'

assertEmailConfigured()

// Photos are the largest body we accept (6 MB plus form overhead); everything else is tiny.
app.listen({ port: env.port, maxRequestBodySize: 8 * 1024 * 1024 })
bus.attach((topic, payload) => app.server?.publish(topic, JSON.stringify(payload)))

// Expire stale presence and tell campuses when the count changes without a heartbeat.
const last = new Map<string, number>()
setInterval(async () => {
  for (const uni of presence.knownCampuses) {
    const n = await presence.count(uni)
    if (last.get(uni) !== n) { last.set(uni, n); bus.publish(topics.campus(uni), { type: 'presence.count', count: n }) }
  }
}, 15_000)

console.log(`api on http://localhost:${env.port}`)
