'use client'
import { useActionState, useState } from 'react'
import Link from 'next/link'
import { AuthShell } from '~/components/ui'
import { mfaAction } from '../actions'

export default function MfaPage() {
  const [state, action, pending] = useActionState(mfaAction, undefined)
  const [backup, setBackup] = useState(false)
  return (
    <AuthShell title="Second step" hint="Lost your authenticator? Use one of the backup codes you saved during setup. Each works once.">
      <form action={action} className="space-y-4" key={String(backup)}>
        <input type="hidden" name="mode" value={backup ? 'backup' : 'totp'} />
        <label className="block text-sm font-semibold">{backup ? 'Backup code' : 'Authenticator code'}
          <input name="code" autoFocus required autoComplete="one-time-code" inputMode={backup ? 'text' : 'numeric'} maxLength={backup ? 20 : 6}
            placeholder={backup ? 'xxxx-xxxx-xxxx' : '000000'} className="input mt-2 h-12 font-mono text-lg tracking-widest" />
        </label>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        <button className="btn w-full" disabled={pending}>{pending ? 'Verifying…' : 'Sign in'}</button>
      </form>
      <div className="flex items-center justify-between text-sm">
        <button type="button" className="text-ink-2 underline underline-offset-2" onClick={() => setBackup(!backup)}>{backup ? 'Use authenticator app' : 'Use a backup code'}</button>
        <Link href="/login" className="text-ink-2 underline underline-offset-2">Start over</Link>
      </div>
    </AuthShell>
  )
}
