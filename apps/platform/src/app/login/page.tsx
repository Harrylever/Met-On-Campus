'use client'
import { useActionState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { AuthShell } from '~/components/ui'
import { loginAction } from './actions'

function Form() {
  const [state, action, pending] = useActionState(loginAction, undefined)
  const expired = useSearchParams().get('expired')
  return (
    <AuthShell title="Staff sign in" hint="Access is limited to approved staff. Every sign-in and every action is recorded.">
      {expired && <p role="status" className="rounded-lg bg-subtle p-3 text-sm text-ink-2">Your session ended. Sign in again.</p>}
      <form action={action} className="space-y-4">
        <label className="block text-sm font-semibold">Email
          <input name="email" type="email" autoComplete="username" required defaultValue={state?.email} key={state?.email} className="input mt-2 font-normal" />
        </label>
        <label className="block text-sm font-semibold">Password
          <input name="password" type="password" autoComplete="current-password" required className="input mt-2 font-normal" />
        </label>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        <button className="btn w-full" disabled={pending}>{pending ? 'Checking…' : 'Continue'}</button>
      </form>
    </AuthShell>
  )
}
export default function LoginPage() { return <Suspense><Form /></Suspense> }
