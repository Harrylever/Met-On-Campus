import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type Intent } from '~/lib/api'

const REASONS = [
  ['harassment', 'Harassment or bullying'], ['unsafe', 'Makes me feel unsafe'], ['inappropriate', 'Inappropriate content'],
  ['fake_profile', 'Fake or misleading profile'], ['spam', 'Spam'], ['other', 'Something else'],
] as const
type Reason = (typeof REASONS)[number][0]

/** Small "Safety" disclosure: block, or report (optionally about one message). Inline, no modal, keyboard friendly. */
export function SafetyMenu({ userId, name, intent, messageId, label = 'Safety', defaultOpen = false, onClose }: { userId: string; name: string; intent?: Intent; messageId?: string; label?: string; defaultOpen?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(defaultOpen)
  const [mode, setMode] = useState<'menu' | 'report'>('menu')
  const [reason, setReason] = useState<Reason>('harassment')
  const [details, setDetails] = useState('')
  const [alsoBlock, setAlsoBlock] = useState(true)
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries()
  // The trigger button is replaced by the menu: keep keyboard and screen reader focus with it.
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  const block = useMutation({ mutationFn: () => unwrap(api.blocks.post({ userId })), onSuccess: () => { setOpen(false); onClose?.(); refresh() } })
  const report = useMutation({
    mutationFn: () => unwrap(api.reports.post({ userId, reason, details: details || undefined, messageId, intent, alsoBlock })),
    onSuccess: refresh,
  })
  const reset = () => { setOpen(false); setMode('menu'); report.reset(); setDetails(''); onClose?.() }

  useEffect(() => {
    if (open) box.current?.querySelector<HTMLElement>('button, input')?.focus()
    else if (wasOpen.current) trigger.current?.focus()
    wasOpen.current = open
  }, [open, mode, report.isSuccess])

  if (!open) return <button ref={trigger} type="button" className="text-[13px] text-ink-2 underline underline-offset-2" aria-expanded={false} onClick={() => setOpen(true)}>{label}</button>

  return (
    <div ref={box} role="group" aria-label={`Safety options for ${name}`} className="space-y-3 rounded-[12px] border border-line bg-surface p-3 text-left text-sm text-ink">
      {report.isSuccess ? (
        <>
          <p className="font-semibold">Thanks. We received your report.</p>
          <p className="text-ink-2">{alsoBlock ? `${name} is now blocked and cannot see you.` : 'You can also block them any time.'}</p>
          <button className="btn btn-ghost h-10" onClick={reset}>Close</button>
        </>
      ) : mode === 'menu' ? (
        <>
          <button className="btn btn-ghost h-11 w-full justify-start" disabled={block.isPending} onClick={() => block.mutate()}>Block {name}</button>
          <p className="text-[13px] text-ink-2">Blocking hides you from each other everywhere, including chats and rooms. You can undo it in Profile.</p>
          <button className="btn btn-ghost h-11 w-full justify-start" onClick={() => setMode('report')}>Report {name}</button>
          <button className="text-[13px] text-ink-2 underline" onClick={reset}>Cancel</button>
        </>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); report.mutate() }}>
          <fieldset className="space-y-2"><legend className="label">What happened{messageId ? ' (about this message)' : ''}</legend>
            {REASONS.map(([v, l]) => <label key={v} className="flex min-h-11 items-center gap-3"><input type="radio" name="reason" className="size-5" checked={reason === v} onChange={() => setReason(v)} />{l}</label>)}
          </fieldset>
          <label className="block font-semibold">Details (optional)<textarea className="input mt-2 h-20 py-2 font-normal" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
          <label className="flex items-center gap-3"><input type="checkbox" className="size-5" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} />Also block {name}</label>
          {report.isError && <p role="alert" className="text-danger">{(report.error as { status?: number }).status === 429 ? 'You have sent a lot of reports today. Try again tomorrow.' : 'Could not send the report. Try again.'}</p>}
          <div className="flex gap-2"><button className="btn flex-1" disabled={report.isPending}>Send report</button><button type="button" className="btn btn-ghost" onClick={() => setMode('menu')}>Back</button></div>
        </form>
      )}
    </div>
  )
}
