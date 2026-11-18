import { describe, expect, test } from 'bun:test'
import { renderEmail } from '../src/mail/render'

describe('email templates', () => {
  test('the sign-in code email: subject, preheader, code in both versions, no unsubscribe line', () => {
    const r = renderEmail('signin', { code: '482915' })
    expect(r.subject).toBe('482915 is your Met On Campus code')
    expect(r.html).toContain('482915'); expect(r.html).toContain('Enter it to confirm your university email')
    expect(r.text).toContain('482915'); expect(r.text).not.toContain('Subject:'); expect(r.text).not.toContain('Preheader:')
    expect(r.html).not.toContain('Turn these emails off'); expect(r.text).not.toContain('Turn these emails off')
  })

  test('the deletion email says it cannot be undone and what to do if it was not them', () => {
    const r = renderEmail('delete-account', { code: '110948' })
    for (const part of [r.html, r.text]) { expect(part).toContain('110948'); expect(part).toContain('cannot be undone'); expect(part).toMatch(/not you/i) }
    expect(r.subject).toContain('110948')
  })

  test('anything put in a template is escaped in HTML (no injected markup) but not mangled in plain text', () => {
    const evil = '<script>alert(1)</script> & "quotes"'
    const r = renderEmail('waiting', { subject: 'S', summary: 'x', lines: [evil], appUrl: 'https://app.test', unsubscribeUrl: 'https://api.test/u/1' })
    expect(r.html).not.toContain('<script>alert(1)</script>')
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;')
    expect(r.text).toContain(evil)
  })

  test('a subject can never carry a line break (header injection)', () => {
    const r = renderEmail('waiting', { subject: 'Hello\r\nBcc: attacker@example.com', summary: 'x', lines: ['a'], appUrl: 'https://app.test' })
    expect(r.subject).not.toMatch(/[\r\n]/)
  })

  test('the unsubscribe line appears only when there is a link', () => {
    const base = { subject: 'S', summary: 'x', lines: ['a'], appUrl: 'https://app.test' }
    expect(renderEmail('waiting', base).html).not.toContain('Turn these emails off')
    const withLink = renderEmail('waiting', { ...base, unsubscribeUrl: 'https://api.test/unsubscribe/abc' })
    expect(withLink.html).toContain('Turn these emails off'); expect(withLink.text).toContain('https://api.test/unsubscribe/abc')
  })
})
