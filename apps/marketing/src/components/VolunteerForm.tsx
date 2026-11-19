'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { parseRole, roles, type RoleId } from '~/lib/volunteers'
import { site } from '~/lib/site'

const levels = ['100 Level', '200 Level', '300 Level', '400 Level', '500 Level', 'Postgraduate']
const field = 'w-full rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none'
const label = 'mb-1.5 block text-[15px] font-semibold text-ink'

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done'; name: string } | { kind: 'error'; message: string }

export function VolunteerForm({ initialRole = 'graphic-designer' }: { initialRole?: RoleId }) {
  const [role, setRole] = useState<RoleId>(initialRole)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const roleTitle = roles.find((r) => r.id === role)!.title
  const doneHeading = useRef<HTMLHeadingElement>(null)

  // The "Apply for this role" buttons link to /volunteers?role=<id>#apply: preselect that role, including on same-page navigation.
  const fromUrl = parseRole(useSearchParams().get('role'))
  useEffect(() => { if (fromUrl) setRole(fromUrl) }, [fromUrl])

  // The form is replaced by the thank-you message; move focus there so keyboard and screen-reader users are not dropped on <body>.
  useEffect(() => { if (status.kind === 'done') doneHeading.current?.focus() }, [status.kind])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>
    setStatus({ kind: 'sending' })
    try {
      const res = await fetch('/volunteers/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, role }) })
      const body = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null
      if (res.ok && body?.ok) { setStatus({ kind: 'done', name: data.name?.trim() ?? '' }); return }
      // A 4xx carries a message the applicant can act on; anything else is our side.
      if (res.status >= 400 && res.status < 500 && body?.error) setStatus({ kind: 'error', message: body.error })
      else setStatus({ kind: 'error', message: `Something went wrong on our side. Please email us at ${site.contactEmail} instead.` })
    } catch {
      setStatus({ kind: 'error', message: `We couldn't reach the server. Check your connection and try again, or email us at ${site.contactEmail}.` })
    }
  }

  if (status.kind === 'done') {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <h3 ref={doneHeading} tabIndex={-1} className="font-display text-2xl outline-none">Thank you{status.name ? `, ${status.name.split(' ')[0]}` : ''}.</h3>
        <p className="mt-3 max-w-[52ch] text-ink-2">We have your application. If we would like to talk further, we will email you at the address you gave.</p>
      </div>
    )
  }

  const sending = status.kind === 'sending'
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate={false}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div><label htmlFor="v-name" className={label}>Full name</label>
          <input id="v-name" name="name" required maxLength={100} autoComplete="name" className={field} /></div>
        <div><label htmlFor="v-email" className={label}>FUTMinna email</label>
          <input id="v-email" name="email" type="email" required maxLength={254} autoComplete="email" placeholder="you@st.futminna.edu.ng" className={field} /></div>
        <div><label htmlFor="v-dept" className={label}>Department</label>
          <input id="v-dept" name="department" required maxLength={100} className={field} /></div>
        <div><label htmlFor="v-level" className={label}>Level</label>
          <select id="v-level" name="level" required defaultValue="" className={field}>
            <option value="" disabled>Choose your level</option>
            {levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select></div>
      </div>

      <div><label htmlFor="v-role" className={label}>Role you are applying for</label>
        <select id="v-role" value={role} onChange={(e) => setRole(e.target.value as RoleId)} className={field}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select></div>

      <div><label htmlFor="v-exp" className={label}>What experience do you have as a {roleTitle}?</label>
        <textarea id="v-exp" name="experience" required rows={5} maxLength={2000} className={field} /></div>
      <div><label htmlFor="v-why" className={label}>Why do you want to volunteer as a {roleTitle}?</label>
        <textarea id="v-why" name="why" required rows={5} maxLength={2000} className={field} /></div>
      <div><label htmlFor="v-extra" className={label}>Anything else we should know? <span className="font-normal text-ink-3">(optional)</span></label>
        <textarea id="v-extra" name="extra" rows={3} maxLength={2000} className={field} /></div>

      {/* Honeypot: invisible to people and screen readers, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <p className="max-w-[60ch] text-sm text-ink-3">Open to current FUTMinna students. This is a volunteer role: there is no guarantee of payment or any financial compensation.</p>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={sending} className="btn disabled:opacity-60">{sending ? 'Sending...' : 'Send application'}</button>
        <p role="alert" className="text-[15px] text-ink">{status.kind === 'error' ? status.message : ''}</p>
      </div>
    </form>
  )
}
