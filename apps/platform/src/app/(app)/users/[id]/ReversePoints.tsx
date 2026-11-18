'use client'
import { useActionState, useState } from 'react'
import { reversePoints } from './actions'

export function ReversePoints({ eventId, userId }: { eventId: string; userId: string }) {
  const [state, action, pending] = useActionState(reversePoints.bind(null, eventId, userId), undefined)
  const [open, setOpen] = useState(false)
  // Controlled: React 19 clears uncontrolled fields after an action, which would wipe the reason on a validation error.
  const [note, setNote] = useState('')
  if (!open) return <button type="button" className="text-xs underline underline-offset-2" onClick={() => setOpen(true)}>Reverse</button>
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input name="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (kept in the audit log)" aria-label="Reason for reversing" maxLength={300} className="input h-9 min-w-52 flex-1 text-xs font-normal" />
      <button className="btn btn-danger h-9 px-3 text-xs" disabled={pending || note.trim().length < 5}>{pending ? 'Reversing…' : 'Reverse'}</button>
      <button type="button" className="btn btn-ghost h-9 px-3 text-xs" onClick={() => setOpen(false)}>Cancel</button>
      {state?.error && <p role="alert" className="basis-full text-xs text-danger">{state.error}</p>}
    </form>
  )
}
