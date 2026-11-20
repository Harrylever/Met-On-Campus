import { describe, expect, it } from 'vitest'
import { genderLabel } from './gender'

describe('genderLabel', () => {
  it('names the two values', () => {
    expect(genderLabel('male')).toBe('Male')
    expect(genderLabel('female')).toBe('Female')
  })
  it('is null when not set, so nothing is drawn', () => {
    expect(genderLabel(null)).toBeNull()
    expect(genderLabel(undefined)).toBeNull()
  })
})
