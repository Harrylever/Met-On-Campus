import { describe, expect, test } from 'bun:test'
import { parseRole, renderApplicationEmail, roles, validateApplication } from '../src/lib/volunteers'

const valid = {
  name: '  Ada Obi  ',
  email: 'ada@st.futminna.edu.ng',
  department: 'Computer Science',
  level: '300',
  role: 'graphic-designer',
  experience: 'Two years designing posters for the faculty.',
  why: 'I want to help students find each other.',
  extra: '',
  website: '',
}

describe('roles', () => {
  test('there are exactly the three agreed roles', () => {
    expect(roles.map((r) => r.id)).toEqual(['graphic-designer', 'video-creator', 'campus-ambassador'])
  })
})

describe('validateApplication', () => {
  test('accepts a valid application and trims fields', () => {
    const r = validateApplication(valid)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.name).toBe('Ada Obi')
  })

  test('accepts st.futminna.edu.ng and bare futminna.edu.ng', () => {
    expect(validateApplication({ ...valid, email: 'a@st.futminna.edu.ng' }).ok).toBe(true)
    expect(validateApplication({ ...valid, email: 'a@futminna.edu.ng' }).ok).toBe(true)
  })

  test('lower-cases the email domain check (A@ST.FUTMINNA.EDU.NG passes)', () => {
    expect(validateApplication({ ...valid, email: 'A@ST.FUTMINNA.EDU.NG' }).ok).toBe(true)
  })

  test.each(['a@gmail.com', 'a@evilfutminna.edu.ng', 'a@futminna.edu.ng.evil.com'])('rejects non-FUTMinna email %s', (email) => {
    const r = validateApplication({ ...valid, email })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('FUTMinna')
  })

  test('rejects an email containing a newline', () => {
    expect(validateApplication({ ...valid, email: 'a@st.futminna.edu.ng\nBcc: x@y.z' }).ok).toBe(false)
  })

  test('rejects an unknown role', () => {
    expect(validateApplication({ ...valid, role: 'developer' }).ok).toBe(false)
  })

  test('rejects over-long answers', () => {
    expect(validateApplication({ ...valid, why: 'x'.repeat(2001) }).ok).toBe(false)
  })

  test.each(['name', 'department', 'level', 'experience', 'why'])('requires %s', (field) => {
    expect(validateApplication({ ...valid, [field]: '   ' }).ok).toBe(false)
  })

  test('extra is optional', () => {
    expect(validateApplication({ ...valid, extra: undefined }).ok).toBe(true)
  })

  test('a filled honeypot fails with the error "spam"', () => {
    const r = validateApplication({ ...valid, website: 'http://spam.example' })
    expect(r).toEqual({ ok: false, error: 'spam' })
  })

  test('non-object input fails', () => {
    expect(validateApplication(null).ok).toBe(false)
    expect(validateApplication('hi').ok).toBe(false)
  })
})

describe('renderApplicationEmail', () => {
  test('escapes HTML in the html body', () => {
    const r = validateApplication({ ...valid, name: '<img src=x onerror=1>' })
    if (!r.ok) throw new Error('expected valid')
    const { html } = renderApplicationEmail(r.value)
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })

  test('subject names the role and applicant and has no newline', () => {
    const r = validateApplication(valid)
    if (!r.ok) throw new Error('expected valid')
    const { subject, text } = renderApplicationEmail(r.value)
    expect(subject).toBe('Volunteer application: Graphic Designer - Ada Obi')
    expect(subject).not.toMatch(/[\r\n]/)
    expect(text).toContain('Two years designing posters')
  })
})

describe('parseRole', () => {
  test('returns a known role id and undefined for anything else', () => {
    expect(parseRole('campus-ambassador')).toBe('campus-ambassador')
    expect(parseRole('developer')).toBeUndefined()
    expect(parseRole(null)).toBeUndefined()
  })
})
