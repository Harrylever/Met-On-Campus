import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '~/lib/api'

const RECENT_DAYS = 14
const MESSAGES: Record<string, string> = {
  invalid_name: 'Use 2 to 60 letters, numbers or common punctuation.',
  already_requested: 'You already have a request open. Withdraw it first to send another.',
  too_many_requests: 'You have sent a few requests today. Try again tomorrow.',
}

/**
 * "My department isn't listed": ask for it to be added. One open request at a time; shows its status, and the outcome
 * of a recent decision. Used on onboarding (where `open` starts expanded) and on the profile.
 */
export function DepartmentRequest({ open: startOpen = false }: { open?: boolean }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(startOpen)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const list = useQuery({ queryKey: ['dept-requests'], queryFn: () => unwrap(api.me['department-requests'].get()) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['dept-requests'] }); qc.invalidateQueries({ queryKey: ['meta'] }) }

  const send = useMutation({
    mutationFn: () => unwrap(api.me['department-requests'].post({ name })),
    onSuccess: () => { setName(''); setOpen(false); setError(null); refresh() },
    onError: (e: { status?: number; value?: { error?: string; name?: string } }) => {
      const code = e.value?.error
      setError(code === 'already_listed' ? `"${e.value?.name}" is already on the list. Choose it from the menu above.` : MESSAGES[code ?? ''] ?? 'Could not send the request. Try again.')
    },
  })
  const withdraw = useMutation({ mutationFn: (id: string) => unwrap(api.me['department-requests']({ id }).delete()), onSuccess: refresh })

  const latest = list.data?.requests[0]
  const pending = latest?.status === 'pending' ? latest : null
  const recentDecision = latest && latest.status !== 'pending' && latest.status !== 'withdrawn' && latest.reviewedAt
    && Date.now() - +new Date(latest.reviewedAt) < RECENT_DAYS * 86_400_000 ? latest : null

  return (
    <div className="space-y-2 text-sm" aria-live="polite">
      {pending && (
        <p className="rounded-[10px] bg-subtle p-3 text-ink">
          Your request for <b>&ldquo;{pending.name}&rdquo;</b> is with our team. You can keep going, and we will let you know when it is added.{' '}
          <button type="button" className="font-semibold underline underline-offset-2" disabled={withdraw.isPending} onClick={() => withdraw.mutate(pending.id)}>Withdraw</button>
        </p>
      )}
      {recentDecision?.status === 'approved' && <p className="rounded-[10px] bg-friends-bg p-3 text-friends-ink">Good news: <b>{recentDecision.resolvedName}</b> was added{recentDecision.name !== recentDecision.resolvedName ? ` (for your request “${recentDecision.name}”)` : ''}.</p>}
      {recentDecision?.status === 'declined' && (
        <p className="rounded-[10px] bg-romance-bg p-3 text-romance-ink">We could not add <b>&ldquo;{recentDecision.name}&rdquo;</b>.{recentDecision.note ? ` ${recentDecision.note}` : ''} Pick one from the list, or request another.</p>
      )}

      {!pending && !open && (
        <button type="button" className="font-semibold text-ink underline underline-offset-2" onClick={() => setOpen(true)}>My department isn&apos;t listed</button>
      )}
      {!pending && open && (
        <form className="space-y-2 rounded-[10px] border border-line bg-surface p-3" onSubmit={(e) => { e.preventDefault(); setError(null); send.mutate() }}>
          <label className="block font-semibold">Your department
            <input className="input mt-2 font-normal" value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setError(null) }} placeholder="e.g. Marine Biology" autoFocus required />
          </label>
          <p className="text-ink-2">We will check it and add it. Until then you will show as &ldquo;Department pending&rdquo;.</p>
          {error && <p role="alert" className="text-danger">{error}</p>}
          <div className="flex gap-2">
            <button className="btn h-11" disabled={send.isPending || name.trim().length < 2}>{send.isPending ? 'Sending…' : 'Send request'}</button>
            <button type="button" className="btn btn-ghost h-11" onClick={() => { setOpen(false); setError(null) }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}
