'use client'
import { useActionState, useState } from 'react'
import { deleteUser } from './actions'

/** For a student who asked us (for example by email) to delete their account. Irreversible, so it takes their email typed out and a reason. */
export function DeleteAccountForm({ userId, name }: { userId: string; name: string }) {
  const [state, action, pending] = useActionState(deleteUser.bind(null, userId), undefined)
  const [open, setOpen] = useState(false)
  // Controlled: React 19 clears uncontrolled fields after an action, which would wipe the reason on a validation error.
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  if (!open) return <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>Delete this account…</button>
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1 text-sm">
        <p className="font-semibold">Permanent. This deletes {name}&apos;s profiles, photos, chats and messages, and cancels rooms they host.</p>
        <p className="text-ink-2">Reports and moderation records are kept (with the account link removed). The deletion is logged with your name and reason, but not their email.</p>
      </div>
      <label className="block text-sm font-semibold">Type the student&apos;s email address to confirm
        <input name="confirmEmail" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className="input mt-2 font-mono text-xs font-normal" /></label>
      <label className="block text-sm font-semibold">Reason (how and when they asked)
        <textarea name="reason" required minLength={5} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className="input mt-2 h-20 py-2 font-normal" /></label>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <button className="btn btn-danger" disabled={pending || !email.trim()}>{pending ? 'Deleting…' : 'Delete account permanently'}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}
