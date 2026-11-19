import { Elysia } from 'elysia'
import { env } from '../env'
import { devOutbox, waitingLines } from '../email'
import { renderEmail, type EmailName } from '../mail/render'

// Development only (never registered in production): see an email as it will look, at /dev/email/<name>, or its
// plain-text version with ?text=1. Add ?light=1 to see the light version even if your browser is in dark mode.
const SAMPLES: Record<EmailName, Record<string, unknown>> = {
  signin: { code: '482915' },
  'delete-account': { code: '110948' },
  waiting: {
    subject: 'You have 3 things waiting on Met On Campus', summary: 'a few things are waiting',
    lines: waitingLines({ invites: 2, chats: 1, rooms: 0 }), appUrl: env.webOrigin, unsubscribeUrl: `${env.publicApiUrl}/unsubscribe/00000000-0000-4000-8000-000000000000`,
  },
}

// The newest sign-in code sent to an address, for browser tests (e2e) that have no inbox. Same rules as the previews: never
// registered in production, and it answers nothing once a real email provider is configured (the outbox is only filled when
// there is none), so it can never expose a real student's code.
export const devEmailRoutes = new Elysia().get('/dev/outbox/:email', ({ params, status }) => {
  if (env.resendApiKey) return status(404, { error: 'not_found' })
  const sent = devOutbox.filter((m) => m.to === params.email.toLowerCase()).at(-1)
  return sent ? { code: sent.code } : status(404, { error: 'not_found' })
}).get('/dev/email/:name', ({ params, query, status }) => {
  const name = params.name as EmailName
  if (!(name in SAMPLES)) return status(404, { error: 'not_found', available: Object.keys(SAMPLES) })
  const r = renderEmail(name, SAMPLES[name])
  return query.text ? new Response(`${r.subject}\n\n${r.text}`, { headers: { 'content-type': 'text/plain; charset=utf-8' } }) : new Response(query.light ? r.html.replace('prefers-color-scheme: dark', 'prefers-color-scheme: never') : r.html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
})
