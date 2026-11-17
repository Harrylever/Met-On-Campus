import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { messages, users } from '@moc/db'
import { db } from '../src/context'
import { call, makeUser, resetAll, type Intent } from './helpers'

beforeEach(resetAll)
const invite = async (from: { token: string }, to: { id: string }, intent: Intent = 'study') =>
  (await call(from, 'POST', '/connections', { toUserId: to.id, intent })).json as { requestId: string | null; conversationId: string; matched: boolean }
const answer = (u: { token: string }, id: string, status: 'accepted' | 'declined') => call(u, 'PATCH', `/connections/${id}`, { status })
const say = (u: { token: string }, conv: string, body = 'hi') => call(u, 'POST', `/conversations/${conv}/messages`, { kind: 'text', body })
const inbox = async (u: { token: string }, intent: Intent = 'study') => (await call(u, 'GET', `/conversations?intent=${intent}`)).json.conversations as any[]
const unread = async (u: { token: string }) => (await call(u, 'GET', '/me/unread')).json

describe('answering an invite', () => {
  test('only the person invited can answer, once', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde'), c = await makeUser('Chidi')
    const { requestId } = await invite(a, b)
    expect((await answer(a, requestId!, 'accepted')).status).toBe(404) // not your own invite
    expect((await answer(c, requestId!, 'accepted')).status).toBe(404) // not a bystander
    expect((await answer(b, requestId!, 'accepted')).status).toBe(200)
    expect((await answer(b, requestId!, 'declined')).status).toBe(404) // already answered
  })

  test('the conversation tells each side where the request stands', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde')
    const { requestId } = await invite(a, b)
    expect((await inbox(a))[0].request).toMatchObject({ status: 'pending', direction: 'sent' })
    expect((await inbox(b))[0].request).toMatchObject({ status: 'pending', direction: 'received', id: requestId })
    await answer(b, requestId!, 'accepted')
    expect((await inbox(a))[0].request.status).toBe('accepted')
  })

  test('until they answer, the person who invited can send one message and no more', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde')
    const { conversationId } = await invite(a, b)
    expect((await say(a, conversationId, 'Hi, want to revise CSS 411?')).status).toBe(200)
    const second = await say(a, conversationId, 'hello??')
    expect(second.status).toBe(409); expect(second.json.error).toBe('waiting_for_reply')
    expect((await say(b, conversationId, 'Sure!')).status).toBe(200) // the invited person can always reply
  })

  test('accepting lifts the limit', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde')
    const { conversationId, requestId } = await invite(a, b)
    await say(a, conversationId); await answer(b, requestId!, 'accepted')
    expect((await say(a, conversationId, 'Great, library at 4?')).status).toBe(200)
  })

  test('not now closes the conversation for both, hides it from the decliner, and keeps them out of their Discover', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde')
    const { conversationId, requestId } = await invite(a, b)
    await say(a, conversationId)
    expect((await answer(b, requestId!, 'declined')).status).toBe(200)
    expect((await say(a, conversationId)).json.error).toBe('conversation_closed')
    expect((await say(b, conversationId)).json.error).toBe('conversation_closed')
    expect(await inbox(b)).toHaveLength(0)                                   // gone from the decliner's list
    expect((await inbox(a))[0].request.status).toBe('declined')              // the inviter sees it closed, nothing harsher
    const seen = (await call(b, 'GET', '/discover?intent=study')).json.cards.map((c: { name: string }) => c.name)
    expect(seen).not.toContain('Amina')
    expect((await call(a, 'GET', '/discover?intent=study')).json.cards.map((c: { name: string }) => c.name)).toContain('Tunde')
  })

  test('a meetup proposal cannot be answered in a closed conversation', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde')
    const { conversationId, requestId } = await invite(a, b)
    const when = new Date(Date.now() + 3600_000).toISOString()
    const m = (await call(a, 'POST', `/conversations/${conversationId}/messages`, { kind: 'meetup', where: 'University Library', when })).json.message
    await answer(b, requestId!, 'declined')
    expect((await call(b, 'PATCH', `/messages/${m.id}/meetup`, { status: 'confirmed' })).status).toBe(403)
  })

  test('if they already invited you, inviting back connects you at once', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde')
    const first = await invite(a, b)
    const back = await invite(b, a)
    expect(back.matched).toBe(true); expect(back.requestId).toBe(first.requestId)
    expect((await inbox(a))[0].request.status).toBe('accepted')
    expect((await say(b, back.conversationId)).status).toBe(200); expect((await say(b, back.conversationId, 'again')).status).toBe(200)
  })

  test('Romance: accepting a Spark is what makes a match', async () => {
    const a = await makeUser('Amina', { modes: ['romance'], department: 'Cyber Security' }), b = await makeUser('Tunde', { modes: ['romance'], department: 'Computer Science' })
    const { requestId } = await invite(a, b, 'romance')
    await answer(b, requestId!, 'accepted')
    const card = (await call(a, 'GET', '/discover?intent=romance')).json.cards.find((c: { name: string }) => c.name === 'Tunde')
    expect(card.request.status).toBe('accepted')
  })
})

describe('unread and waiting invites', () => {
  test('needs a sign-in', async () => { expect((await call(null, 'GET', '/me/unread')).status).toBe(401) })

  test('a new invite counts for the person invited, in the right mode only; the sender has nothing waiting', async () => {
    const a = await makeUser('Amina', { modes: ['study', 'friends'] }), b = await makeUser('Tunde', { modes: ['study', 'friends'] })
    await invite(a, b, 'friends')
    expect(await unread(b)).toMatchObject({ byIntent: { study: 0, friends: 1, romance: 0 }, total: 1, requests: 1 })
    expect(await unread(a)).toMatchObject({ total: 0, requests: 0 })
  })

  test('messages count until the conversation is opened, then clear; one conversation counts once however many messages', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde')
    const { conversationId, requestId } = await invite(a, b)
    await answer(b, requestId!, 'accepted')
    await say(a, conversationId, 'one'); await say(a, conversationId, 'two'); await say(a, conversationId, 'three')
    expect((await inbox(b))[0].unread).toBe(3)
    expect((await unread(b)).total).toBe(1)
    expect((await call(b, 'POST', `/conversations/${conversationId}/read`)).status).toBe(200)
    expect((await inbox(b))[0].unread).toBe(0); expect((await unread(b)).total).toBe(0)
    await say(a, conversationId, 'four')
    expect((await inbox(b))[0].unread).toBe(1)
    expect((await inbox(a))[0].unread).toBe(0) // your own messages are never unread for you
    await call(b, 'POST', `/conversations/${conversationId}/read`) // reading again must clear the new one too
    expect((await inbox(b))[0].unread).toBe(0); expect((await unread(b)).total).toBe(0)
  })

  test('only a participant can mark a conversation read; blocked and declined conversations do not count', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde'), c = await makeUser('Chidi')
    const { conversationId, requestId } = await invite(a, b)
    expect((await call(c, 'POST', `/conversations/${conversationId}/read`)).status).toBe(404)
    await answer(b, requestId!, 'declined')
    expect((await unread(b)).total).toBe(0)
    const d = await invite(c, a); await call(a, 'POST', '/blocks', { userId: c.id })
    expect((await unread(a)).total).toBe(0); expect(d.conversationId).toBeTruthy()
  })
})

describe('display name', () => {
  test('a name must be a first name or nickname: no digits, symbols or one letter', async () => {
    const u = await makeUser('Amina')
    for (const name of ['m2200765', 'dean m2200765', 'A', '<b>x</b>', 'x'.repeat(41), '1234']) {
      expect((await call(u, 'PATCH', '/me', { name })).status).toBe(422)
    }
    for (const name of ['Amina', "  Ngozi   O'Brien ", 'Aïssatou', 'Mary-Jane']) expect((await call(u, 'PATCH', '/me', { name })).status).toBe(200)
    expect((await call(u, 'GET', '/me')).json.user.name).toBe('Mary-Jane')
  })

  test('an old email-derived name does not block saving other details, but cannot be re-entered once changed', async () => {
    const u = await makeUser('dean m2200765')
    await db.update(users).set({ name: 'dean m2200765' }).where(eq(users.id, u.id))
    expect((await call(u, 'PATCH', '/me', { name: 'dean m2200765', level: 400 })).status).toBe(200)
    expect((await call(u, 'PATCH', '/me', { name: 'Dean' })).status).toBe(200)
    expect((await call(u, 'PATCH', '/me', { name: 'dean m2200765' })).status).toBe(422)
  })
})

describe('long chats and old proposals', () => {
  test('the newest 200 messages are returned, oldest first, so a long chat keeps showing new ones', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde')
    const { conversationId, requestId } = await invite(a, b)
    await answer(b, requestId!, 'accepted')
    for (let i = 1; i <= 205; i++) await db.insert(messages).values({ conversationId, senderId: i % 2 ? a.id : b.id, kind: 'text', body: `m${i}`, createdAt: new Date(Date.now() - (206 - i) * 1000) })
    const list = (await call(a, 'GET', `/conversations/${conversationId}/messages`)).json.messages as { body: string }[]
    expect(list).toHaveLength(200)
    expect(list[0]!.body).toBe('m6'); expect(list.at(-1)!.body).toBe('m205')
  })

  test('a meetup proposal whose time has passed can no longer be answered', async () => {
    const a = await makeUser('Amina'), b = await makeUser('Tunde')
    const { conversationId, requestId } = await invite(a, b)
    await answer(b, requestId!, 'accepted')
    const [m] = await db.insert(messages).values({ conversationId, senderId: a.id, kind: 'meetup', meetupWhere: 'University Library', meetupWhen: new Date(Date.now() - 60_000), meetupStatus: 'pending' }).returning()
    const r = await call(b, 'PATCH', `/messages/${m!.id}/meetup`, { status: 'confirmed' })
    expect(r.status).toBe(409); expect(r.json.error).toBe('expired')
  })
})

describe('Discover paging and search', () => {
  async function crowd(n: number) {
    const me = await makeUser('Viewer')
    for (let i = 1; i <= n; i++) await makeUser(`Student${String.fromCharCode(64 + (i % 26 || 26))}${i}`, { tags: i % 5 === 0 ? ['CSS 411'] : ['Football'] })
    return me
  }
  test('sends a page at a time, with the total and online count for everyone who matches', async () => {
    const me = await crowd(30)
    const first = (await call(me, 'GET', '/discover?intent=study')).json
    expect(first.cards).toHaveLength(24); expect(first.total).toBe(30)
    expect((await call(me, 'GET', '/discover?intent=study&limit=30')).json.cards).toHaveLength(30)
    expect((await call(me, 'GET', '/discover?intent=study&limit=0')).status).toBe(422)
    expect((await call(me, 'GET', '/discover?intent=study&limit=101')).status).toBe(422)
  })
  test('searches names, prompts and tags without case mattering, and the total follows the search', async () => {
    const me = await crowd(30)
    const byTag = (await call(me, 'GET', '/discover?intent=study&q=css%20411')).json
    expect(byTag.total).toBe(6); expect(byTag.cards.every((c: { tags: string[] }) => c.tags.includes('CSS 411'))).toBe(true)
    expect((await call(me, 'GET', '/discover?intent=study&q=STUDENTA')).json.cards.every((c: { name: string }) => c.name.startsWith('StudentA'))).toBe(true)
    expect((await call(me, 'GET', '/discover?intent=study&q=zzzz-nothing')).json.total).toBe(0)
  })
})
