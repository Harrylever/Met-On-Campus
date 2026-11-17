'use client'
import { useActionState, useState } from 'react'
import { setSuspension } from './actions'

export function SuspensionForm({ userId, name, suspended }: { userId: string; name: string; suspended: boolean }) {
  const [state, action, pending] = useActionState(setSuspension.bind(null, userId, !suspended), undefined)
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm font-semibold">{suspended ? `Reason for restoring ${name}` : `Reason for suspending ${name}`}
        <textarea name="note" required minLength={5} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="input mt-2 h-20 py-2 font-normal" /></label>
      {!suspended && <label className="flex items-center gap-3 text-sm"><input type="checkbox" name="confirm" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="size-5" />Suspend now. They are signed out immediately and hidden from everyone.</label>}
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button className={`btn ${suspended ? '' : 'btn-danger'}`} disabled={pending}>{pending ? 'Saving…' : suspended ? 'Restore account' : 'Suspend account'}</button>
    </form>
  )
}
