'use client'
import { useRef, useState, useTransition } from 'react'
import { nf } from '~/lib/format'
import { openCampus, updateCampus, type Result } from './actions'

type Campus = { slug: string; name: string; open: boolean; emailDomains: string[]; students: number; departments: number; spots: number }
type Asked = { slug: string; attempts: number; lastAt: string }
/** st.abu.edu.ng -> abu: the part right before .edu.ng, which is how a campus is identified. */
const slugFromDomain = (raw: string) => /([a-z0-9]+(?:-[a-z0-9]+)*)\.edu\.ng\s*$/i.exec(raw.trim().split(/[\s,;]+/)[0] ?? '')?.[1]?.toLowerCase() ?? ''

export function CampusManager({ campuses, asked }: { campuses: Campus[]; asked: Asked[] }) {
  const form = useRef<HTMLFormElement>(null)
  // Controlled fields: React 19 clears uncontrolled ones after an action, which would wipe the input on a validation error.
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [domains, setDomains] = useState('')
  const [template, setTemplate] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const onDomains = (v: string) => { setDomains(v); setError(null); if (!slugEdited) setSlug(slugFromDomain(v)) }
  const prefill = (s: string) => { setSlug(s); setSlugEdited(true); setError(null); form.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setError(null)
    start(async () => {
      const r = await openCampus({ name, slug, domains, fromTemplate: template })
      if (r.error) return setError(r.error)
      setName(''); setSlug(''); setSlugEdited(false); setDomains('')
    })
  }
  const open = new Set(campuses.map((c) => c.slug))

  return (
    <>
      <form ref={form} onSubmit={submit} className="card space-y-3">
        <h2 className="text-lg font-semibold">Open a university</h2>
        <div className="flex flex-wrap gap-3">
          <label className="min-w-56 flex-1 text-sm font-semibold">Name
            <input className="input mt-2 font-normal" value={name} maxLength={120} placeholder="Ahmadu Bello University" required onChange={(e) => { setName(e.target.value); setError(null) }} />
          </label>
          <label className="min-w-56 flex-1 text-sm font-semibold">Student email domain
            <input className="input mt-2 font-mono font-normal" value={domains} maxLength={600} placeholder="st.abu.edu.ng" onChange={(e) => onDomains(e.target.value)} />
          </label>
          <label className="w-40 text-sm font-semibold">Short name
            <input className="input mt-2 font-mono font-normal" value={slug} maxLength={40} required onChange={(e) => { setSlug(e.target.value.toLowerCase()); setSlugEdited(true); setError(null) }} />
          </label>
        </div>
        <p className="text-xs text-ink-2">Only addresses on this domain can create an account, exactly (<span className="font-mono">st.abu.edu.ng</span> does not allow <span className="font-mono">x.st.abu.edu.ng</span>). Separate several domains with commas. Leave it empty and any address at the university can sign up. The short name is the part right before <span className="font-mono">.edu.ng</span> and is filled in for you.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={template} onChange={(e) => setTemplate(e.target.checked)} /> Start with a copy of the standard departments and campus spots</label>
        <button className="btn" disabled={pending || !name.trim() || !slug.trim()}>{pending ? 'Opening…' : 'Open university'}</button>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead><tr className="label"><th className="p-3 font-medium">University</th><th className="p-3 font-medium">Student email domain</th><th className="p-3 font-medium">Students</th><th className="p-3 font-medium">Departments</th><th className="p-3 font-medium">Spots</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{campuses.map((c) => <Row key={c.slug} c={c} />)}
            {campuses.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-ink-2">No universities yet. Open the first one above.</td></tr>}</tbody>
        </table>
      </div>

      <section aria-labelledby="asked-heading" className="space-y-3">
        <div><h2 id="asked-heading" className="text-lg font-semibold">Asked to join</h2><p className="text-sm text-ink-2">Attempts to sign up from universities that are not open yet, counted by university only (no emails, names or IPs are kept). Open the ones with the most interest.</p></div>
        {asked.filter((a) => !open.has(a.slug)).length === 0 ? <p className="card text-sm text-ink-2">Nobody has asked yet.</p> : (
          <ul className="card divide-y divide-line p-0">
            {asked.filter((a) => !open.has(a.slug)).map((a) => (
              <li key={a.slug} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="font-mono">{a.slug}</span><span className="text-ink-2">{nf.format(a.attempts)} {a.attempts === 1 ? 'attempt' : 'attempts'}</span>
                <button type="button" className="btn btn-ghost ml-auto h-9 px-3" onClick={() => prefill(a.slug)}>Open…</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function Row({ c }: { c: Campus }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(c.name)
  const [domains, setDomains] = useState(c.emailDomains.join(', '))
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<Result>, after?: () => void) => { setError(null); start(async () => { const r = await fn(); if (r.error) setError(r.error); else after?.() }) }

  return (
    <tr className="border-t border-line align-top">
      <td className="p-3">
        {editing ? <input aria-label={`Name for ${c.slug}`} className="input h-9 w-56" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /> : <b>{c.name}</b>}
        <div className="font-mono text-xs text-ink-3">{c.slug}</div>
      </td>
      <td className="p-3">
        {editing
          ? <input aria-label={`Student email domains for ${c.name}`} className="input h-9 w-64 font-mono" value={domains} maxLength={600} placeholder={`st.${c.slug}.edu.ng`} onChange={(e) => setDomains(e.target.value)} />
          : c.emailDomains.length > 0
            ? <span className="flex flex-wrap gap-1">{c.emailDomains.map((d) => <span key={d} className="badge font-mono">{d}</span>)}</span>
            : <span className="text-warn">Any address at this university</span>}
      </td>
      <td className="p-3 tabular-nums">{nf.format(c.students)}</td><td className="p-3 tabular-nums">{nf.format(c.departments)}</td><td className="p-3 tabular-nums">{nf.format(c.spots)}</td>
      <td className="p-3"><span className={`badge ${c.open ? '' : 'text-warn'}`}>{c.open ? 'Open' : 'Paused'}</span></td>
      <td className="p-3">
        <div className="flex flex-wrap justify-end gap-2">
          {editing ? (
            <>
              <button className="btn h-9 px-3" disabled={pending || !name.trim()} onClick={() => run(() => updateCampus(c.slug, { name, domains }), () => setEditing(false))}>Save</button>
              <button className="btn btn-ghost h-9 px-3" disabled={pending} onClick={() => { setEditing(false); setName(c.name); setDomains(c.emailDomains.join(', ')); setError(null) }}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost h-9 px-3" onClick={() => setEditing(true)}>Edit</button>
              <button className="btn btn-ghost h-9 px-3" disabled={pending} onClick={() => run(() => updateCampus(c.slug, { open: !c.open }))}>{c.open ? 'Pause' : 'Resume'}</button>
            </>
          )}
        </div>
        {error && <p role="alert" className="mt-2 max-w-xs text-right text-xs text-danger">{error}</p>}
        {!editing && !c.open && <p className="mt-2 max-w-xs text-right text-xs text-ink-3">Paused: no new sign-ups. Students already in keep using the app.</p>}
      </td>
    </tr>
  )
}
