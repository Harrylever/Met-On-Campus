import { describe, expect, test } from 'vitest'
import { rateLimitedText } from './limits'

const tooMany = (retryAfter?: number) => ({ status: 429, value: { error: 'too_many_requests', ...(retryAfter === undefined ? {} : { retryAfter }) } })

describe('rateLimitedText', () => {
  test.each([
    [20, '20 seconds'], [1, '1 second'], [89, '89 seconds'], [120, '2 minutes'], [420, '7 minutes'], [5000, '83 minutes'], [7200, 'about 2 hours'], [86400, 'about 24 hours'],
  ])('a wait of %i seconds reads "%s"', (seconds, text) => {
    expect(rateLimitedText(tooMany(seconds), 'invites')).toBe(`You have reached the limit for invites for now. Try again in ${text}.`)
  })

  test('says what was limited', () => expect(rateLimitedText(tooMany(60), 'rooms')).toContain('limit for rooms'))
  test('without a wait time it falls back to a minute', () => expect(rateLimitedText(tooMany(), 'messages')).toContain('60 seconds'))

  test.each([null, undefined, {}, new Error('x'), { value: {} }, { value: { error: 'not_allowed' } }, { value: { error: 'conversation_closed' } }])('any other error (%j) is not ours: null', (e) => {
    expect(rateLimitedText(e, 'invites')).toBeNull()
  })
})
