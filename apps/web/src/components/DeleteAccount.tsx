import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '~/lib/api'

type ApiError = { status?: number; value?: { error?: string; retryAfter?: number } }
const wait = (s: number) => (s <= 90 ? `${s} second${s === 1 ? '' : 's'}` : `about ${Math.ceil(s / 60)} minutes`)

/**
 * Delete your own account. It cannot be undone, so it takes a fresh code emailed to your university address and the
 * word DELETE, and it says plainly what goes and what stays.
 */
export function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const head = useRef<HTMLHeadingElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  // The button that opens this is replaced by the warning: focus moves to it, and back when it is closed.
  useEffect(() => {
    if (open) head.current?.focus()
    else if (wasOpen.current) opener.current?.focus()
    wasOpen.current = open
  }, [open])
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [word, setWord] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (resendAt <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [resendAt])
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000))

  const ask = useMutation({
    mutationFn: () => unwrap(api.me.delete.code.post()),
    onSuccess: () => { setSent(true); setCode(''); setNow(Date.now()); setResendAt(Date.now() + 60_000) },
    onError: (e: ApiError) => { if (e.status === 429 && e.value?.retryAfter) { setNow(Date.now()); setResendAt(Date.now() + e.value.retryAfter * 1000) } },
  })
  const remove = useMutation({
    mutationFn: () => unwrap(api.me.delete.post({ code, confirm: 'DELETE' })),
    onSuccess: () => { onDeleted(); qc.clear(); window.location.assign('/login?deleted=1') },
  })

  const askError = (() => {
    const e = ask.error as ApiError | null
    if (!e) return null
    if (e.status === 429) return `You asked a moment ago. Try again in ${wait(e.value?.retryAfter ?? 60)}.`
    return 'We could not send the code. Check your connection and try again.'
  })()
  const removeError = (() => {
    const e = remove.error as ApiError | null
    if (!e) return null
    if (e.status === 429) return 'Too many tries. Ask for a new code in a few minutes.'
    if (e.value?.error === 'code_expired') return 'That code has expired. Send a new one.'
    if (e.value?.error === 'code_invalid') return 'That code is not right. Use the newest email, or send a new code.'
    return 'We could not delete your account. Try again.'
  })()

  if (!open) {
    return (
      <section className="card space-y-2" aria-labelledby="delete-heading">
        <h2 id="delete-heading" className="text-[17px] font-semibold">Delete your account</h2>
        <p className="text-sm text-ink-2">Permanently remove your profiles, photos, messages, points and badges. This cannot be undone.</p>
        <button ref={opener} type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>Delete my account…</button>
      </section>
    )
  }
  return (
    <section className="card space-y-4 border-danger" aria-labelledby="delete-heading">
      <h2 ref={head} tabIndex={-1} id="delete-heading" className="text-[17px] font-semibold outline-none">Delete your account</h2>
      <div className="space-y-2 text-sm">
        <p className="font-semibold">This is permanent and cannot be undone.</p>
        <p><b>We delete:</b> your profiles and photos, your points, streak and badges (and your place on the leaderboard), your chats and the messages in them (including the other person&apos;s side of those chats), your invitations, and your sign-in. Rooms you host are cancelled and the people in them are told.</p>
        <p><b>We keep:</b> reports and safety records, because deleting an account must not erase them. They no longer link to you; a report about you keeps only your name and university. Access logs stay too, and they do not contain your email.</p>
        <p className="text-ink-2">You can join again later, but as a new account with nothing carried over.</p>
      </div>
      {!sent ? (
        <div className="space-y-2">
          <p className="text-sm text-ink-2">To make sure it is you, we will email a 6-digit code to your university address.</p>
          {askError && <p role="alert" className="text-sm text-danger">{askError}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn" disabled={ask.isPending} onClick={() => ask.mutate()}>{ask.isPending ? 'Sending…' : 'Email me a code'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Keep my account</button>
          </div>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (code.length === 6 && word === 'DELETE') remove.mutate() }}>
          <label className="block text-sm font-semibold">Code from your email
            <input className="input mt-2 font-mono text-lg tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </label>
          <label className="block text-sm font-semibold">Type DELETE to confirm
            <input className="input mt-2 font-normal" autoComplete="off" autoCapitalize="characters" value={word} onChange={(e) => setWord(e.target.value)} />
          </label>
          {removeError && <p role="alert" className="text-sm text-danger">{removeError}</p>}
          {askError && <p role="alert" className="text-sm text-danger">{askError}</p>}
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-danger" disabled={code.length !== 6 || word !== 'DELETE' || remove.isPending}>{remove.isPending ? 'Deleting…' : 'Delete my account forever'}</button>
            <button type="button" className="btn btn-ghost" disabled={secondsLeft > 0 || ask.isPending} onClick={() => { remove.reset(); ask.mutate() }}>{secondsLeft > 0 ? `Send a new code in ${secondsLeft}s` : 'Send a new code'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setSent(false); setCode(''); setWord(''); remove.reset(); ask.reset() }}>Keep my account</button>
          </div>
        </form>
      )}
    </section>
  )
}
