'use client'
import { useActionState, useState } from 'react'
import { resolveReport } from './actions'

export function ResolveForm({ reportId, name }: { reportId: string; name: string }) {
  const [state, action, pending] = useActionState(resolveReport.bind(null, reportId), undefined)
  // Controlled: React 19 resets uncontrolled fields after every action, which would wipe a moderator's reason on a validation error.
  const [choice, setChoice] = useState('')
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  if (state?.done) return <p role="status" className="text-sm text-ok">Resolved.</p>
  return (
    <form action={action} className="space-y-3 border-t border-line pt-3">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Action for {name}</legend>
        {[['dismiss', 'Dismiss'], ['warn', 'Record warning'], ['suspend', 'Suspend account']].map(([v, l]) => (
          <label key={v} className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${choice === v ? 'border-ink bg-subtle font-semibold' : 'border-line'}`}>
            <input type="radio" name="action" value={v} checked={choice === v} className="sr-only" onChange={() => setChoice(v)} required />{l}
          </label>
        ))}
      </fieldset>
      {choice === 'warn' && <p className="text-xs text-ink-2">A warning is recorded on the student&apos;s history. They are not notified yet.</p>}
      {choice && (
        <label className="block text-sm font-semibold">{choice === 'dismiss' ? 'Note (optional)' : 'Reason (required, kept in the audit log)'}
          <textarea name="note" maxLength={1000} required={choice !== 'dismiss'} value={note} onChange={(e) => setNote(e.target.value)} className="input mt-2 h-20 py-2 font-normal" /></label>
      )}
      {choice === 'suspend' && <label className="flex items-center gap-3 text-sm"><input type="checkbox" name="confirm" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="size-5" />Suspend {name} now. They are signed out immediately and hidden from everyone.</label>}
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {choice && <button className={`btn ${choice === 'suspend' ? 'btn-danger' : ''}`} disabled={pending}>{pending ? 'Saving…' : choice === 'suspend' ? 'Suspend' : 'Save'}</button>}
    </form>
  )
}
