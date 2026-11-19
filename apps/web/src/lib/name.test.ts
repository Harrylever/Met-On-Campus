import { describe, expect, test } from 'vitest'
import { looksLikeMatric, tidyName, validPersonName } from './name'

describe('validPersonName', () => {
  test.each(['Amina', 'Ngozi Obi', 'Ade-Wale', "O'Neil", 'Chidi Ọkafọ', 'Zoë', '  Amina   Bello  '])('accepts %j', (n) => expect(validPersonName(n)).toBe(true))
  test.each(['', ' ', 'A', 'Amina2', '19/ENG/1234', '2019', '-Amina', '.Amina', 'x'.repeat(41), '<b>Amina</b>', 'Amina_Bello'])('rejects %j', (n) => expect(validPersonName(n)).toBe(false))
  test('40 letters is the longest allowed', () => {
    expect(validPersonName('a'.repeat(40))).toBe(true)
    expect(validPersonName('a'.repeat(41))).toBe(false)
  })
})

test('tidyName trims and collapses spaces', () => expect(tidyName('  Amina   Bello \n')).toBe('Amina Bello'))
test('a name with a digit looks like a matric number (accounts started with the email name)', () => {
  expect(looksLikeMatric('19eng1234')).toBe(true)
  expect(looksLikeMatric('Amina')).toBe(false)
})
