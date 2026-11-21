import { beforeEach, describe, expect, test } from 'bun:test'
import { call, makeUser, resetAll, type TestUser } from './helpers'

beforeEach(resetAll)

const names = async (viewer: TestUser, intent: string) =>
  ((await call(viewer, 'GET', `/discover?intent=${intent}`)).json.cards as { name: string }[]).map((c) => c.name).sort()
const spark = (from: TestUser, to: TestUser) => call(from, 'POST', '/connections', { toUserId: to.id, intent: 'romance' })

// Four people in Romance: two men, two women, and one who has not set a gender.
async function crowd() {
  const male = await makeUser('Tunde', { modes: ['romance'], gender: 'male' })
  const male2 = await makeUser('Emeka', { modes: ['romance'], gender: 'male' })
  const female = await makeUser('Amara', { modes: ['romance'], gender: 'female' })
  const female2 = await makeUser('Hauwa', { modes: ['romance'], gender: 'female' })
  const blank = await makeUser('Sam', { modes: ['romance'] })
  const blank2 = await makeUser('Kelechi', { modes: ['romance'] })
  return { male, male2, female, female2, blank, blank2 }
}

describe('Romance Discover and gender', () => {
  test('a man who set his gender sees only women who set theirs', async () => {
    const { male } = await crowd()
    expect(await names(male, 'romance')).toEqual(['Amara', 'Hauwa'])
  })

  test('a woman who set her gender sees only men who set theirs', async () => {
    const { female } = await crowd()
    expect(await names(female, 'romance')).toEqual(['Emeka', 'Tunde'])
  })

  test('someone with no gender set sees only others with none, and is hidden from people who set one', async () => {
    const { blank, male } = await crowd()
    expect(await names(blank, 'romance')).toEqual(['Kelechi'])
    expect(await names(male, 'romance')).not.toContain('Sam')
  })

  test('the total count follows the filter', async () => {
    const { male } = await crowd()
    const r = await call(male, 'GET', '/discover?intent=romance')
    expect(r.json.total).toBe(2)
  })

  test('Study and Friends ignore gender completely', async () => {
    const a = await makeUser('Tunde', { modes: ['study', 'friends'], gender: 'male' })
    await makeUser('Emeka', { modes: ['study', 'friends'], gender: 'male' })
    await makeUser('Sam', { modes: ['study', 'friends'] })
    expect(await names(a, 'study')).toEqual(['Emeka', 'Sam'])
    expect(await names(a, 'friends')).toEqual(['Emeka', 'Sam'])
  })

  test('changing your gender changes who you see straight away', async () => {
    const { male } = await crowd()
    expect(await names(male, 'romance')).toEqual(['Amara', 'Hauwa'])
    await call(male, 'PATCH', '/me', { gender: 'female' })
    expect(await names(male, 'romance')).toEqual(['Emeka']) // now a woman, so she sees the men who set theirs (not herself)
  })
})

describe('Sparks and gender', () => {
  test('a Spark to someone of the opposite gender works', async () => {
    const { male, female } = await crowd()
    expect((await spark(male, female)).status).toBe(200)
  })

  test('a Spark to someone of the same gender is refused with 403 not_allowed, even though the API is called directly', async () => {
    const { male, male2, female, female2 } = await crowd()
    const m = await spark(male, male2)
    expect(m.status).toBe(403); expect(m.json.error).toBe('not_allowed')
    expect((await spark(female, female2)).status).toBe(403)
  })

  test('a Spark between someone who set a gender and someone who did not is refused both ways', async () => {
    const { male, blank } = await crowd()
    expect((await spark(male, blank)).status).toBe(403)
    expect((await spark(blank, male)).status).toBe(403)
  })

  test('two people with no gender set can still Spark each other', async () => {
    const { blank, blank2 } = await crowd()
    expect((await spark(blank, blank2)).status).toBe(200)
  })

  test('the same-gender rule does not apply to Study or Friends invites', async () => {
    const a = await makeUser('Tunde', { modes: ['study'], gender: 'male' })
    const b = await makeUser('Emeka', { modes: ['study'], gender: 'male' })
    expect((await call(a, 'POST', '/connections', { toUserId: b.id, intent: 'study' })).status).toBe(200)
  })
})
