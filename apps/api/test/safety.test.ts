import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { reports } from '@moc/db'
import { db } from '../src/context'
import { call, makeUser, resetAll } from './helpers'

beforeEach(resetAll)
const future = () => new Date(Date.now() + 3600_000).toISOString()
const names = (r: { json: any }) => (r.json.cards as { name: string }[]).map((c) => c.name)

async function pair(modes: ('study' | 'friends' | 'romance')[] = ['study']) {
  const a = await makeUser('Amina', { modes }), b = await makeUser('Tunde', { modes })
  const conv = (await call(a, 'POST', '/connections', { toUserId: b.id, intent: modes[0]! })).json.conversationId as string
  return { a, b, conv }
}

describe('blocking', () => {
  test('hides both people from each other in discover', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde'), c = await makeUser('Hauwa')
    await call(a, 'POST', '/blocks', { userId: b.id })
    expect(names(await call(a, 'GET', '/discover?intent=study'))).toEqual(['Hauwa'])
    expect(names(await call(b, 'GET', '/discover?intent=study'))).toEqual(['Hauwa']) // blocked person cannot see the blocker either
    expect(names(await call(c, 'GET', '/discover?intent=study')).sort()).toEqual(['Amina', 'Tunde'])
  })

  test('prevents new connections in either direction', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde')
    await call(a, 'POST', '/blocks', { userId: b.id })
    expect((await call(a, 'POST', '/connections', { toUserId: b.id, intent: 'study' })).status).toBe(403)
    expect((await call(b, 'POST', '/connections', { toUserId: a.id, intent: 'study' })).status).toBe(403)
  })

  test('freezes an existing conversation: hidden, unreadable, unwritable, meetups unanswerable', async () => {
    const { a, b, conv } = await pair()
    const proposal = (await call(a, 'POST', `/conversations/${conv}/messages`, { kind: 'meetup', where: 'University Library', when: future() })).json.message.id
    await call(b, 'POST', '/blocks', { userId: a.id })
    for (const u of [a, b]) {
      expect((await call(u, 'GET', '/conversations?intent=study')).json.conversations).toHaveLength(0)
      expect((await call(u, 'GET', `/conversations/${conv}/messages`)).status).toBe(404)
      expect((await call(u, 'POST', `/conversations/${conv}/messages`, { kind: 'text', body: 'hi' })).status).toBe(404)
    }
    expect((await call(b, 'PATCH', `/messages/${proposal}/meetup`, { status: 'confirmed' })).status).toBe(404)
  })

  test('hides the blocker\'s rooms and refuses room requests', async () => {
    const host = await makeUser('Host'), guest = await makeUser('Guest')
    const room = (await call(host, 'POST', '/rooms', { intent: 'study', tag: 'CSS', title: 'T', place: 'Library', startsAt: new Date().toISOString(), endsAt: future(), capacity: 4 })).json.room.id
    expect((await call(guest, 'GET', '/rooms?intent=study')).json.rooms).toHaveLength(1)
    await call(host, 'POST', '/blocks', { userId: guest.id })
    expect((await call(guest, 'GET', '/rooms?intent=study')).json.rooms).toHaveLength(0)
    expect((await call(guest, 'POST', `/rooms/${room}/request`)).status).toBe(404)
  })

  test('unblocking restores visibility', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde')
    await call(a, 'POST', '/blocks', { userId: b.id })
    await call(a, 'DELETE', `/blocks/${b.id}`)
    expect(names(await call(a, 'GET', '/discover?intent=study'))).toEqual(['Tunde'])
  })

  test('validates: no self-block, same campus only, idempotent, lists blocked', async () => {
    const a = await makeUser('Amina'), far = await makeUser('Far', { university: 'unilag' }), b = await makeUser('Tunde')
    expect((await call(a, 'POST', '/blocks', { userId: a.id })).status).toBe(422)
    expect((await call(a, 'POST', '/blocks', { userId: far.id })).status).toBe(404)
    expect((await call(a, 'POST', '/blocks', { userId: b.id })).status).toBe(200)
    expect((await call(a, 'POST', '/blocks', { userId: b.id })).status).toBe(200)
    expect((await call(a, 'GET', '/blocks')).json.blocked.map((x: any) => x.name)).toEqual(['Tunde'])
  })
})

describe('reporting', () => {
  test('stores a report with a snapshot of the reported message', async () => {
    const { a, b, conv } = await pair()
    const msg = (await call(b, 'POST', `/conversations/${conv}/messages`, { kind: 'text', body: 'something awful' })).json.message.id
    const r = await call(a, 'POST', '/reports', { userId: b.id, reason: 'harassment', messageId: msg, details: 'repeated' })
    expect(r.status).toBe(200)
    const [row] = await db.select().from(reports).where(eq(reports.id, r.json.id))
    expect(row).toMatchObject({ reporterId: a.id, reportedId: b.id, reason: 'harassment', intent: 'study', messageSnapshot: 'something awful', status: 'open' })
  })

  test('alsoBlock blocks in the same step', async () => {
    const { a, b } = await pair()
    await call(a, 'POST', '/reports', { userId: b.id, reason: 'spam', alsoBlock: true })
    expect((await call(a, 'GET', '/blocks')).json.blocked).toHaveLength(1)
  })

  test('cannot attach a message from someone else\'s conversation or sent by a different person', async () => {
    const { a, b, conv } = await pair()
    const eve = await makeUser('Eve'), x = await makeUser('Xavier')
    const fromB = (await call(b, 'POST', `/conversations/${conv}/messages`, { kind: 'text', body: 'hi' })).json.message.id
    expect((await call(eve, 'POST', '/reports', { userId: b.id, reason: 'spam', messageId: fromB })).status).toBe(404) // not her conversation
    expect((await call(a, 'POST', '/reports', { userId: x.id, reason: 'spam', messageId: fromB })).status).toBe(404) // not sent by X
  })

  test('rejects self-reports, unknown reasons, and other campuses; caps at 10/day', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde'), far = await makeUser('Far', { university: 'unilag' })
    expect((await call(a, 'POST', '/reports', { userId: a.id, reason: 'spam' })).status).toBe(422)
    expect((await call(a, 'POST', '/reports', { userId: b.id, reason: 'bored' })).status).toBe(422)
    expect((await call(a, 'POST', '/reports', { userId: far.id, reason: 'spam' })).status).toBe(404)
    const out: number[] = []
    for (let i = 0; i < 11; i++) out.push((await call(a, 'POST', '/reports', { userId: b.id, reason: 'spam' })).status)
    // the 404 above already used 1 of the 10 daily reports (self/validation failures are rejected before counting)
    expect(out.filter((st) => st === 200)).toHaveLength(9)
    expect(out.slice(-2)).toEqual([429, 429])
  })
})
