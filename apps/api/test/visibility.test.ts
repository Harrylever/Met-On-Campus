import { beforeEach, describe, expect, test } from 'bun:test'
import { call, makeUser, resetAll } from './helpers'

beforeEach(resetAll)
const names = (r: { json: any }) => (r.json.cards as { name: string }[]).map((c) => c.name).sort()

describe('discover visibility', () => {
  test('requires the mode to be enabled for the viewer', async () => {
    const a = await makeUser('Amina', { modes: ['study'] })
    await makeUser('Zainab', { modes: ['romance'] })
    expect((await call(a, 'GET', '/discover?intent=romance')).status).toBe(403)
  })

  test('only shows people who enabled the same mode, never email', async () => {
    const a = await makeUser('Amina', { modes: ['study'] })
    await makeUser('Tunde', { modes: ['study'] })
    await makeUser('Ibrahim', { modes: ['friends'] })
    const r = await call(a, 'GET', '/discover?intent=study')
    expect(names(r)).toEqual(['Tunde'])
    expect(JSON.stringify(r.json)).not.toContain('@')
  })

  test('is scoped to the viewer\'s university', async () => {
    const a = await makeUser('Amina', { modes: ['study'] })
    await makeUser('Other', { modes: ['study'], university: 'unilag' })
    expect(names(await call(a, 'GET', '/discover?intent=study'))).toEqual([])
  })

  test('romance is mutual opt-in', async () => {
    const z = await makeUser('Zainab', { modes: ['romance'], department: 'IT' })
    await makeUser('Emeka', { modes: ['romance'], department: 'EE' })
    await makeUser('Tunde', { modes: ['study'], department: 'EE' })
    expect(names(await call(z, 'GET', '/discover?intent=romance'))).toEqual(['Emeka'])
  })

  test('"hide from my department" works from either side', async () => {
    const hider = await makeUser('Hider', { modes: ['romance'], department: 'CS', hide: true })
    const sameDept = await makeUser('Same', { modes: ['romance'], department: 'CS' })
    const otherDept = await makeUser('Other', { modes: ['romance'], department: 'EE' })
    expect(names(await call(hider, 'GET', '/discover?intent=romance'))).toEqual(['Other'])
    expect(names(await call(sameDept, 'GET', '/discover?intent=romance'))).toEqual(['Other']) // cannot see the hider, still sees other departments
    expect(names(await call(otherDept, 'GET', '/discover?intent=romance'))).toEqual(['Hider', 'Same'])
  })

  test('cannot connect across a mode the other person has not enabled', async () => {
    const a = await makeUser('Amina', { modes: ['study', 'romance'] })
    const t = await makeUser('Tunde', { modes: ['study'] })
    expect((await call(a, 'POST', '/connections', { toUserId: t.id, intent: 'romance' })).status).toBe(403)
    expect((await call(a, 'POST', '/connections', { toUserId: t.id, intent: 'study' })).status).toBe(200)
  })
})

describe('inbox segmentation', () => {
  test('a Study conversation never appears in Friends or Romance', async () => {
    const a = await makeUser('Amina', { modes: ['study', 'friends', 'romance'] })
    const t = await makeUser('Tunde', { modes: ['study', 'friends', 'romance'], department: 'EE' })
    await call(a, 'POST', '/connections', { toUserId: t.id, intent: 'study' })
    for (const [intent, n] of [['study', 1], ['friends', 0], ['romance', 0]] as const) {
      expect((await call(t, 'GET', `/conversations?intent=${intent}`)).json.conversations).toHaveLength(n)
    }
  })

  test('the same pair gets a separate conversation per mode', async () => {
    const a = await makeUser('Amina', { modes: ['study', 'friends'] })
    const t = await makeUser('Tunde', { modes: ['study', 'friends'] })
    const s = await call(a, 'POST', '/connections', { toUserId: t.id, intent: 'study' })
    const f = await call(a, 'POST', '/connections', { toUserId: t.id, intent: 'friends' })
    expect(s.json.conversationId).not.toBe(f.json.conversationId)
  })

  test('outsiders cannot read a conversation', async () => {
    const a = await makeUser('Amina'), t = await makeUser('Tunde'), x = await makeUser('Eve')
    const c = await call(a, 'POST', '/connections', { toUserId: t.id, intent: 'study' })
    expect((await call(x, 'GET', `/conversations/${c.json.conversationId}/messages`)).status).toBe(404)
  })
})
