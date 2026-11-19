import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { devOutbox } from '../src/email'
import { env } from '../src/env'
import { call, resetAll } from './helpers'

beforeEach(async () => { await resetAll(); devOutbox.length = 0 })
afterEach(() => { env.resendApiKey = '' })
const ask = (email: string) => call(null, 'POST', '/auth/request-code', { email }, { 'x-forwarded-for': `10.4.0.${Math.floor(Math.random() * 250)}` })

describe('the sign-in code lookup used by browser tests', () => {
  test('returns the newest code sent to an address', async () => {
    await ask('amina@st.futminna.edu.ng')
    const r = await call(null, 'GET', '/dev/outbox/amina@st.futminna.edu.ng')
    expect(r.status).toBe(200)
    expect(r.json.code).toBe(devOutbox.at(-1)!.code)
    expect(r.json.code).toMatch(/^\d{6}$/)
  })

  test('an address nothing was sent to is a 404', async () => {
    expect((await call(null, 'GET', '/dev/outbox/nobody@st.futminna.edu.ng')).status).toBe(404)
  })

  test('is switched off whenever a real email provider is configured', async () => {
    await ask('amina@st.futminna.edu.ng')
    env.resendApiKey = 're_live_key'
    expect((await call(null, 'GET', '/dev/outbox/amina@st.futminna.edu.ng')).status).toBe(404)
  })
})
