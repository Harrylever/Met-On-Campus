import { expect, type Browser, type BrowserContext, type PlaywrightWorkerArgs } from '@playwright/test'
import { base32Decode, hotp } from '../../api/src/admin/totp'
import { API_ENV, DATABASE_URL, URLS } from '../env'

/** The 6-digit code an authenticator app would show right now. */
export const authenticatorCode = (secret: string) => hotp(base32Decode(secret), Math.floor(Date.now() / 30_000))

let counter = 0
/** A fresh address every call, so tests never collide with each other or with an earlier run. */
export const uniqueEmail = (tag: string, domain = 'st.futminna.edu.ng') => `${tag}${Date.now().toString(36)}${counter++}@${domain}`

export type Student = { name: string; email: string; token: string }

/**
 * Creates a student through the API (sign-in code, name, Study mode), the fast way to get someone who already exists. Each
 * student gets their own request context, so cookies never mix.
 */
export async function makeStudent(playwright: PlaywrightWorkerArgs['playwright'], name: string): Promise<Student> {
  const api = await playwright.request.newContext()
  try {
    const email = uniqueEmail(name.toLowerCase())
    expect((await api.post(`${URLS.api}/auth/request-code`, { data: { email } })).ok()).toBeTruthy()
    const { code } = await (await api.get(`${URLS.api}/dev/outbox/${email}`)).json()
    const verified = await api.post(`${URLS.api}/auth/verify`, { data: { email, code } })
    expect(verified.ok()).toBeTruthy()
    const token = /moc_session=([^;]+)/.exec(verified.headers()['set-cookie'] ?? '')![1]!
    // The context's own cookie jar now holds the session, so the next calls are signed in as this student.
    expect((await api.patch(`${URLS.api}/me`, { data: { name, level: 300, department: 'Computer Science' } })).ok()).toBeTruthy()
    expect((await api.put(`${URLS.api}/me/profiles/study`, { data: { enabled: true, prompt: `${name} is revising for exams`, tags: ['CSS 411'] } })).ok()).toBeTruthy()
    return { name, email, token }
  } finally { await api.dispose() }
}

/** A browser that is already signed in as this student. */
export async function browserAs(browser: Browser, student: Student): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: URLS.web })
  await context.addCookies([{ name: 'moc_session', value: student.token, domain: 'localhost', path: '/' }])
  return context
}

/**
 * Makes this student premium for a day (the flag online-room hosts need), straight in the e2e database. The test process
 * has no API environment of its own, so it is set (to the throwaway database) before the API code is first loaded.
 */
export async function makePremium(student: Student): Promise<void> {
  if (!/_e2e(\?|$)/.test(DATABASE_URL)) throw new Error(`Refusing to touch "${DATABASE_URL}". The database name must end in _e2e.`)
  Object.assign(process.env, API_ENV)
  const { setPremium } = await import('../../api/src/premium')
  await setPremium(student.email, 1)
}
