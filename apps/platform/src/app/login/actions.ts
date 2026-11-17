'use server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { rawAdminApi } from '~/lib/admin-api'
import { CHALLENGE_COOKIE, SESSION_COOKIE, cookieOptions, sessionToken } from '~/lib/session'

export type FormState = { error?: string; email?: string } | undefined
const wait = (s?: number) => `Too many attempts. Try again in ${Math.max(1, Math.ceil((s ?? 60) / 60))} min.`

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get('email') ?? '').trim()
  const password = String(fd.get('password') ?? '')
  if (!email || !password) return { error: 'Enter your email and password.', email }
  const r = await rawAdminApi('/admin/auth/login', { body: { email, password } })
  if (r.status === 429) return { error: wait(r.data?.retryAfter), email }
  if (!r.ok) return { error: 'Email or password is incorrect, or the account is locked.', email } // never say which
  ;(await cookies()).set(CHALLENGE_COOKIE, r.data.challenge, cookieOptions(300))
  redirect('/login/mfa')
}

export async function mfaAction(_: FormState, fd: FormData): Promise<FormState> {
  const jar = await cookies()
  const challenge = jar.get(CHALLENGE_COOKIE)?.value
  if (!challenge) redirect('/login')
  const backup = fd.get('mode') === 'backup'
  const value = String(fd.get('code') ?? '').trim()
  if (!value) return { error: backup ? 'Enter a backup code.' : 'Enter the 6-digit code.' }
  const r = await rawAdminApi('/admin/auth/mfa', { body: { challenge, ...(backup ? { backupCode: value } : { code: value }) } })
  if (r.status === 429) return { error: wait(r.data?.retryAfter) }
  if (!r.ok) return { error: 'That code did not work. Each code works once; after 5 wrong tries you must start again.' }
  jar.delete(CHALLENGE_COOKIE)
  jar.set(SESSION_COOKIE, r.data.sessionToken, cookieOptions(8 * 3600))
  redirect('/')
}

export async function logoutAction() {
  const session = await sessionToken()
  if (session) await rawAdminApi('/admin/auth/logout', { method: 'POST', body: {}, session }).catch(() => {})
  ;(await cookies()).delete(SESSION_COOKIE)
  redirect('/login')
}
