import { beforeEach, describe, expect, test } from 'bun:test'
import { call, makeUser, resetAll } from './helpers'

beforeEach(resetAll)
const future = (h = 1) => new Date(Date.now() + h * 3600_000).toISOString()
type U = { id: string; token: string }

async function setup(capacity = 5) {
  const host = await makeUser('Host'), ada = await makeUser('Ada'), bayo = await makeUser('Bayo'), other = await makeUser('Other')
  const room = (await call(host, 'POST', '/rooms', { intent: 'study', tag: 'CSS 411', title: 'Past questions', place: 'University Library', startsAt: new Date().toISOString(), endsAt: future(2), capacity })).json.room.id as string
  return { host, ada, bayo, other, room }
}
const request = (u: U, room: string) => call(u, 'POST', `/rooms/${room}/request`)
const decide = (host: U, room: string, who: U, decision: 'approved' | 'declined') => call(host, 'POST', `/rooms/${room}/requests/${who.id}`, { decision })
const list = async (u: U) => (await call(u, 'GET', '/rooms?intent=study')).json.rooms as any[]
const roomsBadge = async (u: U) => (await call(u, 'GET', '/me/unread')).json.rooms as number

describe('what people are told', () => {
  test('a host sees how many are waiting; answering them clears it', async () => {
    const { host, ada, bayo, room } = await setup()
    expect(await roomsBadge(host)).toBe(0)
    await request(ada, room); await request(bayo, room)
    expect(await roomsBadge(host)).toBe(2)
    await decide(host, room, ada, 'approved'); await decide(host, room, bayo, 'declined')
    expect(await roomsBadge(host)).toBe(0)
  })

  test('a member is told when approved or declined, and opening Rooms clears it', async () => {
    const { host, ada, bayo, room } = await setup()
    await request(ada, room); await request(bayo, room)
    expect(await roomsBadge(ada)).toBe(0) // still waiting is not news
    await decide(host, room, ada, 'approved'); await decide(host, room, bayo, 'declined')
    expect(await roomsBadge(ada)).toBe(1); expect(await roomsBadge(bayo)).toBe(1)
    expect((await list(ada))[0]).toMatchObject({ myStatus: 'approved', decisionUnseen: true })
    expect((await list(bayo))[0]).toMatchObject({ myStatus: 'declined', decisionUnseen: true })
    expect((await call(ada, 'POST', '/rooms/seen')).status).toBe(200)
    expect(await roomsBadge(ada)).toBe(0); expect((await list(ada))[0].decisionUnseen).toBe(false)
    expect(await roomsBadge(bayo)).toBe(1) // everyone has their own news
  })

  test('an answer is news even if they already opened Rooms while waiting', async () => {
    const { host, ada, room } = await setup()
    await request(ada, room)
    await call(ada, 'POST', '/rooms/seen')            // looked while still pending
    expect(await roomsBadge(ada)).toBe(0)
    await decide(host, room, ada, 'approved')         // the answer arrives afterwards
    expect(await roomsBadge(ada)).toBe(1); expect((await list(ada))[0].decisionUnseen).toBe(true)
  })

  test('hosting your own room is not news to yourself', async () => {
    const { host } = await setup()
    expect(await roomsBadge(host)).toBe(0); expect((await list(host))[0].decisionUnseen).toBe(false)
  })
})

describe('cancelling a room', () => {
  test('only the host can; once', async () => {
    const { host, ada, room } = await setup()
    expect((await call(ada, 'DELETE', `/rooms/${room}`)).status).toBe(403)
    expect((await call(host, 'DELETE', `/rooms/${room}`)).status).toBe(200)
    expect((await call(host, 'DELETE', `/rooms/${room}`)).status).toBe(409)
  })

  test('people who had a place or were waiting still see it, marked cancelled, and are told; nobody else sees it', async () => {
    const { host, ada, bayo, other, room } = await setup()
    await request(ada, room); await decide(host, room, ada, 'approved'); await call(ada, 'POST', '/rooms/seen')
    await request(bayo, room)
    await call(host, 'DELETE', `/rooms/${room}`)
    expect((await list(ada))[0]).toMatchObject({ cancelled: true, live: false, decisionUnseen: true })
    expect((await list(bayo))[0]).toMatchObject({ cancelled: true, decisionUnseen: true })
    expect(await roomsBadge(ada)).toBe(1); expect(await roomsBadge(bayo)).toBe(1)
    expect(await list(other)).toHaveLength(0)  // never shown to people who were not in it
    expect(await list(host)).toHaveLength(0)   // the host chose to cancel it
  })

  test('a cancelled room takes no more requests and no more decisions', async () => {
    const { host, ada, bayo, room } = await setup()
    await request(ada, room)
    await call(host, 'DELETE', `/rooms/${room}`)
    expect((await request(bayo, room)).status).toBe(404)
    const d = await decide(host, room, ada, 'approved')
    expect(d.status).toBe(409); expect(d.json.error).toBe('cancelled')
    expect(await roomsBadge(host)).toBe(0) // waiting people on a cancelled room are not waiting on the host
  })
})

describe('editing a room', () => {
  test('only the host can, and everyone sees the new details', async () => {
    const { host, ada, other, room } = await setup()
    expect((await call(ada, 'PATCH', `/rooms/${room}`, { title: 'Hijacked' })).status).toBe(403)
    expect((await call(host, 'PATCH', `/rooms/${room}`, { title: 'Network security revision', place: 'ICT Centre', capacity: 8 })).status).toBe(200)
    expect((await list(other))[0]).toMatchObject({ title: 'Network security revision', place: 'ICT Centre', capacity: 8 })
    expect((await list(ada)).length).toBe(1)
  })

  test('capacity cannot drop below the people already in; times must make sense', async () => {
    const { host, ada, bayo, room } = await setup(4)
    await request(ada, room); await request(bayo, room)
    await decide(host, room, ada, 'approved'); await decide(host, room, bayo, 'approved') // host + 2 = 3
    expect((await call(host, 'PATCH', `/rooms/${room}`, { capacity: 2 })).json.error).toBe('capacity_below_members')
    expect((await call(host, 'PATCH', `/rooms/${room}`, { capacity: 3 })).status).toBe(200)
    expect((await call(host, 'PATCH', `/rooms/${room}`, { startsAt: future(5) })).json.error).toBe('bad_time_range') // starts after it ends
    expect((await call(host, 'PATCH', `/rooms/${room}`, { endsAt: new Date(Date.now() - 3600_000).toISOString() })).json.error).toBe('bad_time_range')
  })

  test('a cancelled room cannot be edited', async () => {
    const { host, room } = await setup()
    await call(host, 'DELETE', `/rooms/${room}`)
    expect((await call(host, 'PATCH', `/rooms/${room}`, { title: 'Back again' })).json.error).toBe('cancelled')
  })
})
