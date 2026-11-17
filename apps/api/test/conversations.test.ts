import { beforeEach, describe, expect, test } from 'bun:test'
import { call, makeUser, resetAll } from './helpers'

beforeEach(resetAll)
const future = (h = 1) => new Date(Date.now() + h * 3600_000).toISOString()

async function pair() {
  const a = await makeUser('Amina'), b = await makeUser('Tunde')
  const conv = (await call(a, 'POST', '/connections', { toUserId: b.id, intent: 'study' })).json.conversationId as string
  return { a, b, conv }
}

describe('meetup proposals', () => {
  test('only public campus spots in the future are accepted', async () => {
    const { a, conv } = await pair()
    const send = (where: string, when: string) => call(a, 'POST', `/conversations/${conv}/messages`, { kind: 'meetup', where, when })
    expect((await send("12 Private Street", future())).status).toBe(422)
    expect((await send('University Library', new Date(Date.now() - 3600_000).toISOString())).status).toBe(422)
    expect((await send('University Library', future())).status).toBe(200)
  })

  test('only the recipient can accept or decline, and only once', async () => {
    const { a, b, conv } = await pair()
    const id = (await call(a, 'POST', `/conversations/${conv}/messages`, { kind: 'meetup', where: 'Faculty Quad', when: future() })).json.message.id
    expect((await call(a, 'PATCH', `/messages/${id}/meetup`, { status: 'confirmed' })).status).toBe(404) // sender cannot self-confirm
    expect((await call(b, 'PATCH', `/messages/${id}/meetup`, { status: 'confirmed' })).status).toBe(200)
    expect((await call(b, 'PATCH', `/messages/${id}/meetup`, { status: 'declined' })).status).toBe(409)
  })

  test('empty text messages are rejected', async () => {
    const { a, conv } = await pair()
    expect((await call(a, 'POST', `/conversations/${conv}/messages`, { kind: 'text', body: '   ' })).status).toBe(422)
  })
})
