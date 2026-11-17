import { beforeEach, describe, expect, test } from 'bun:test'
import { call, makeUser, resetAll } from './helpers'

beforeEach(resetAll)
const future = (h = 1) => new Date(Date.now() + h * 3600_000).toISOString()

describe('rooms', () => {
  test('host is counted as taken; full rooms cannot be approved into', async () => {
    const host = await makeUser('Host'), g1 = await makeUser('G1'), g2 = await makeUser('G2')
    const room = (await call(host, 'POST', '/rooms', { intent: 'study', tag: 'X', title: 'T', place: 'Library', startsAt: new Date().toISOString(), endsAt: future(), capacity: 2 })).json.room.id
    expect((await call(host, 'GET', '/rooms?intent=study')).json.rooms[0].taken).toBe(1)
    await call(g1, 'POST', `/rooms/${room}/request`); await call(g2, 'POST', `/rooms/${room}/request`)
    expect((await call(host, 'POST', `/rooms/${room}/requests/${g1.id}`, { decision: 'approved' })).status).toBe(200)
    expect((await call(host, 'POST', `/rooms/${room}/requests/${g2.id}`, { decision: 'approved' })).status).toBe(409)
  })

  test('concurrent approvals cannot overfill a room', async () => {
    const host = await makeUser('Host')
    const guests = await Promise.all(Array.from({ length: 6 }, (_, i) => makeUser(`G${i}`)))
    const room = (await call(host, 'POST', '/rooms', { intent: 'friends', tag: 'X', title: 'T', place: 'School Field', startsAt: new Date().toISOString(), endsAt: future(), capacity: 3 })).json.room.id
    for (const g of guests) await call(g, 'POST', `/rooms/${room}/request`)
    const results = await Promise.all(guests.map((g) => call(host, 'POST', `/rooms/${room}/requests/${g.id}`, { decision: 'approved' })))
    expect(results.filter((r) => r.status === 200)).toHaveLength(2) // capacity 3 minus the host
    expect((await call(host, 'GET', '/rooms?intent=friends')).json.rooms[0].taken).toBe(3)
  })

  test('only the host can see or decide requests', async () => {
    const host = await makeUser('Host'), g = await makeUser('Guest'), x = await makeUser('Other')
    const room = (await call(host, 'POST', '/rooms', { intent: 'study', tag: 'X', title: 'T', place: 'Library', startsAt: new Date().toISOString(), endsAt: future(), capacity: 4 })).json.room.id
    await call(g, 'POST', `/rooms/${room}/request`)
    expect((await call(x, 'GET', `/rooms/${room}/requests`)).status).toBe(403)
    expect((await call(g, 'POST', `/rooms/${room}/requests/${g.id}`, { decision: 'approved' })).status).toBe(403)
  })

  test('rejects rooms that end before they start, and romance rooms', async () => {
    const host = await makeUser('Host')
    const base = { tag: 'X', title: 'T', place: 'Library', capacity: 4 }
    expect((await call(host, 'POST', '/rooms', { ...base, intent: 'study', startsAt: future(2), endsAt: future(1) })).status).toBe(422)
    expect((await call(host, 'POST', '/rooms', { ...base, intent: 'romance', startsAt: future(1), endsAt: future(2) })).status).toBe(422)
  })
})
