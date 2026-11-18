import Mustache from 'mustache'
import { readFileSync } from 'node:fs'

// Every email is a Mustache template pair (`<name>.html` for the body, `<name>.txt` for the plain-text version, whose
// first line is `Subject: ...`) wrapped in one shared `layout.html`. Mustache escapes {{values}} for HTML by default, so
// anything user-supplied that ever goes into an email cannot inject markup. Plain text and subjects are rendered with no
// escaping (they are not HTML).
const dir = new URL('./templates/', import.meta.url)
const read = (file: string) => readFileSync(new URL(file, dir), 'utf8')
const layout = read('layout.html')
const templates = new Map<string, { html: string; txt: string }>()
const load = (name: string) => {
  let t = templates.get(name)
  if (!t) { t = { html: read(`${name}.html`), txt: read(`${name}.txt`) }; templates.set(name, t) }
  return t
}

const asText = (value: unknown) => String(value ?? '')
// Escapes what can break out of HTML text or a quoted attribute. (Mustache's default also rewrites `/`, which turns every
// link into `http:&#x2F;&#x2F;…`: harmless to browsers, but ugly and fragile for mail scanners.)
const HTML: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const asHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => HTML[c]!)
// Header fields must never contain line breaks.
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()

export type EmailName = 'signin' | 'delete-account' | 'waiting'
export type Rendered = { subject: string; html: string; text: string }

/** `data` is what the templates read; `unsubscribeUrl` (when present) adds the "turn these off" line to both versions. */
export function renderEmail(name: EmailName, data: Record<string, unknown>): Rendered {
  const t = load(name)
  const raw = Mustache.render(t.txt, data, {}, { escape: asText })
  // Leading `Key: value` lines are the header (Subject, Preheader); the first blank line starts the plain-text body.
  const split = raw.indexOf('\n\n')
  const head = Object.fromEntries(raw.slice(0, split < 0 ? undefined : split).split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim().toLowerCase(), oneLine(l.slice(i + 1))] }))
  const subject = head.subject ?? ''
  const preheader = head.preheader ?? ''
  const text = (split < 0 ? '' : raw.slice(split + 2)).trim() + '\n'
  const body = Mustache.render(t.html, data, {}, { escape: asHtml })
  const html = Mustache.render(layout, { ...data, subject, preheader, body }, {}, { escape: asHtml })
  return { subject, html, text }
}
