import { useEffect, useId, useState } from 'react'
import { createFileRoute, useBlocker, useNavigate, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, INTENTS, type Intent } from '~/lib/api'
import { IntentTabs } from '~/components/ui'
import { PROMPT_SUGGESTIONS, createSuggester } from '~/lib/prompts'
import { deptLabel } from '~/lib/dept'
import { DepartmentRequest } from '~/components/DepartmentRequest'
import { PhotoField } from '~/components/PhotoField'
import { DeleteAccount } from '~/components/DeleteAccount'
import { EmailAlerts } from '~/components/EmailAlerts'
import { InstallCard } from '~/components/InstallApp'
import { PushNotifications } from '~/components/PushNotifications'
import { forgetThisDevice } from '~/lib/push'
import { looksLikeMatric, validPersonName } from '~/lib/name'
import type { Gender } from '~/lib/gender'
import { BlockedListSkeleton, LoadingRegion, ProfileFormSkeleton, Skeleton, useSkeleton } from '~/components/Skeleton'

export const Route = createFileRoute('/_app/profile')({ component: Profile })

// Everything below the tabs depends on the campus lists (spots, usually-free presets), so those load first.
type Meta = { departments: string[]; spots: string[]; freeTimes: readonly string[] }
const MAX_FREE = 160 // keep in step with the API

function Profile() {
  const { me } = Route.useRouteContext()
  const router = useRouter()
  const nav = useNavigate()
  const [mode, setMode] = useState<Intent>('study')
  const profileFor = (i: Intent) => me.profiles.find((p) => p.intent === i)
  // Which modes have edits that are not saved yet. Every mode's form stays mounted, so switching tabs never loses typing.
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => unwrap(api.meta.get()), staleTime: 60_000 })
  const showSkeleton = useSkeleton(meta.isLoading)

  const logout = useMutation({ mutationFn: async () => { await forgetThisDevice(); return unwrap(api.auth.logout.post()) }, onSuccess: () => nav({ to: '/login' }) })
  const [name, setName] = useState(me.user.name)
  const [department, setDepartment] = useState(me.user.department)
  const [level, setLevel] = useState(me.user.level)
  const [gender, setGender] = useState<Gender | ''>(me.user.gender ?? '')
  const qc = useQueryClient()
  const basicsDirty = name !== me.user.name || department !== me.user.department || level !== me.user.level || gender !== (me.user.gender ?? '')
  const anyDirty = basicsDirty || Object.values(dirty).some(Boolean)
  const [deleted, setDeleted] = useState(false) // once the account is gone there is nothing to save
  // Leaving with unsaved edits asks first (in-app navigation and closing the tab).
  useBlocker({ shouldBlockFn: () => !window.confirm('You have unsaved changes. Leave without saving?'), enableBeforeUnload: () => anyDirty && !deleted, disabled: !anyDirty || deleted })
  const saveBasics = useMutation({ mutationFn: () => unwrap(api.me.patch({ name, department, level, gender: gender || null })), onSuccess: () => { router.invalidate(); qc.invalidateQueries({ queryKey: ['discover'] }) } })

  return (
    <div data-intent={mode} className="flex flex-col gap-5">
      <h1 className="text-[28px] font-bold leading-[34px]">Your profiles</h1>


      <section className="card space-y-3">
        <span className="label">About you (shown on every mode)</span>
        <label className="block text-sm font-semibold">Name<input className="input mt-2 font-normal" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-describedby="profile-name-hint" />
          <span id="profile-name-hint" className={`mt-1.5 block text-xs font-normal ${looksLikeMatric(name) ? 'text-danger' : 'text-ink-2'}`}>
            {looksLikeMatric(name) ? 'This looks like it includes your matric number. Use your first name or a nickname.' : 'Other students see this name. Use your first name or a nickname.'}
          </span></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">Department
            <select className="input mt-2 h-11 font-normal" value={department} onChange={(e) => setDepartment(e.target.value)}>
              {[...new Set([department, ...(meta.data?.departments ?? [])])].map((d) => <option key={d} value={d}>{deptLabel(d)}</option>)}
            </select></label>
          <label className="block text-sm font-semibold">Level
            <select className="input mt-2 h-11 font-normal" value={level} onChange={(e) => setLevel(+e.target.value)}>{[100, 200, 300, 400, 500].map((l) => <option key={l} value={l}>{l}L</option>)}</select></label>
        </div>
        <label className="block text-sm font-semibold">Gender (optional)
          <select className="input mt-2 h-11 font-normal" value={gender} onChange={(e) => setGender(e.target.value as Gender | '')} aria-describedby="profile-gender-hint">
            <option value="">Prefer not to say</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
          <span id="profile-gender-hint" className="mt-1.5 block text-xs font-normal text-ink-2">Shown as a small icon on your cards. You can hide it in each mode below.</span></label>
        <DepartmentRequest />
        <button className="btn" disabled={saveBasics.isPending || (name !== me.user.name && !validPersonName(name))} onClick={() => saveBasics.mutate()}>{saveBasics.isSuccess && !basicsDirty ? 'Saved' : 'Save details'}</button>
        {basicsDirty && <p className="text-sm text-ink-2" role="status">You have unsaved changes to your details.</p>}
        <span className="sr-only" role="status" aria-live="polite">{saveBasics.isSuccess && !basicsDirty ? 'Details saved' : ''}</span>
        {saveBasics.isError && <p role="alert" className="text-sm text-danger">Could not save. Use letters only for your name, then try again.</p>}
      </section>

      <IntentTabs value={mode} onChange={setMode} options={INTENTS} marks={dirty} />
      {/* One form per mode, all kept mounted (the others hidden): each keeps its own edits, so switching tabs loses nothing and one mode's edits never bleed into another. */}
      {meta.data
        ? INTENTS.map((i) => (
          <div key={i.id} hidden={mode !== i.id}>
            <ModeForm mode={i.id} profile={profileFor(i.id)} meta={meta.data} name={me.user.name} hasGender={!!me.user.gender} onSaved={() => router.invalidate()} onDirty={(d) => setDirty((x) => (x[i.id] === d ? x : { ...x, [i.id]: d }))} />
          </div>
        ))
        : meta.isError ? <p className="card text-sm text-ink-2" role="alert">Could not load your profile options. Refresh to try again.</p>
        : showSkeleton ? <LoadingRegion label="Loading your profile"><ProfileFormSkeleton /></LoadingRegion> : null}

      <InstallCard />

      <PushNotifications />

      <EmailAlerts on={me.settings.emailAlerts} onChanged={() => router.invalidate()} />

      <BlockedList />

      <button className="btn btn-ghost" onClick={() => logout.mutate()}>Sign out</button>

      <DeleteAccount onDeleted={() => setDeleted(true)} />
    </div>
  )
}

type P = NonNullable<ReturnType<typeof Route.useRouteContext>['me']['profiles'][number]>
function ModeForm({ mode, profile, meta, name, hasGender, onSaved, onDirty }: { mode: Intent; profile?: P; meta: Meta; name: string; hasGender: boolean; onSaved: () => void; onDirty: (dirty: boolean) => void }) {
  const [enabled, setEnabled] = useState(profile?.enabled ?? false)
  const [prompt, setPrompt] = useState(profile?.prompt ?? '')
  // Prompt suggestions: one shuffled pass per mode. `undo` holds what the person had typed if a suggestion replaced it.
  const nextSuggestion = useState(() => createSuggester(mode))[0]
  const [suggested, setSuggested] = useState(false)
  const [undo, setUndo] = useState<string | null>(null)
  const [spins, setSpins] = useState(0)
  const promptId = useId()
  const suggest = () => {
    const wroteItThemselves = prompt.trim() !== '' && !PROMPT_SUGGESTIONS[mode].includes(prompt)
    setUndo(wroteItThemselves ? prompt : null)
    setPrompt(nextSuggestion(prompt))
    setSuggested(true)
    setSpins((n) => n + 1)
  }
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [tags, setTags] = useState((profile?.tags ?? []).join(', '))
  // "Usually free" is stored as one line. Presets that match become chips; anything else is the custom note.
  const initial = splitFree(profile?.usuallyFree ?? '', meta.freeTimes)
  const [freeSel, setFreeSel] = useState<string[]>(initial.selected)
  const [freeNote, setFreeNote] = useState(initial.note)
  const usuallyFree = composeFree(freeSel, freeNote, meta.freeTimes)
  const [usualSpot, setSpot] = useState(profile?.usualSpot ?? '')
  const [hide, setHide] = useState(profile?.hideFromDepartment ?? true)
  const [showGender, setShowGender] = useState(profile?.showGender ?? true)
  // Keep a spot you already have visible even if staff archived it, so saving never silently clears it.
  const spotOptions = [...new Set([profile?.usualSpot ?? '', ...meta.spots])].filter(Boolean)
  const qc = useQueryClient()

  // What is on screen now vs what was last saved, to know when there is something to lose.
  const snapshot = JSON.stringify([enabled, prompt, bio, tags, usuallyFree, usualSpot, mode === 'romance' ? hide : null, showGender])
  const [savedAs, setSavedAs] = useState(snapshot)
  const isDirty = snapshot !== savedAs
  useEffect(() => { onDirty(isDirty) }, [isDirty]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => unwrap(api.me.profiles({ intent: mode }).put({
      enabled, prompt, bio, usuallyFree, usualSpot, showGender,
      tags: tags.split(",").map((t: string) => t.trim()).filter(Boolean).slice(0, 6),
      ...(mode === 'romance' ? { hideFromDepartment: hide } : {}),
    })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['discover'] }); setSavedAs(snapshot); onSaved() },
  })
  const field = 'block text-sm font-semibold'
  return (
    <section className="card space-y-4 border-(--i-line) bg-(--i-bg)">
      <label className="flex items-center justify-between gap-3 font-semibold">
        <span>{mode[0]!.toUpperCase() + mode.slice(1)} Mode is {enabled ? 'on' : 'off'}</span>
        <input type="checkbox" role="switch" className="size-6" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      </label>
      <PhotoField mode={mode} modeOn={profile?.enabled ?? false} name={name} />
      {hasGender && (
        <label className="flex items-center justify-between gap-3 font-semibold">
          <span>Show my gender on my cards<span className="block text-xs font-normal text-ink-2">Only shown if you set it in About you.</span></span>
          <input type="checkbox" role="switch" className="size-6" checked={showGender} onChange={(e) => setShowGender(e.target.checked)} />
        </label>
      )}
      <div>
        <label htmlFor={promptId} className={field}>Prompt</label>
        {/* The button sits inside the input's right edge. It fills the field with a ready-made prompt (see lib/prompts.ts). */}
        <div className="relative mt-2">
          <input id={promptId} className="input pr-12 font-normal" maxLength={160} value={prompt}
            onChange={(e) => { setPrompt(e.target.value); setSuggested(false); setUndo(null) }} placeholder="One line that starts a conversation" />
          <button type="button" onClick={suggest} aria-label="Suggest a prompt" title="Suggest a prompt"
            className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-(--i-ink) hover:bg-(--i-bg)">
            <svg viewBox="0 0 24 24" className="size-5 transition-transform duration-300 ease-out motion-reduce:transition-none" style={{ transform: `rotate(${spins * 180}deg)` }}
              fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4" />
            </svg>
          </button>
        </div>
        <p className="mt-1.5 min-h-5 text-xs text-ink-2" aria-live="polite">
          {suggested ? 'A suggestion. Edit it to make it yours, or tap the arrows for another.' : 'Not sure what to write? Tap the arrows for an idea.'}
          {undo !== null && <> <button type="button" className="font-semibold text-(--i-ink) underline underline-offset-2" onClick={() => { setPrompt(undo); setUndo(null); setSuggested(false) }}>Undo</button></>}
        </p>
      </div>
      <label className={field}>About<textarea className="input mt-2 h-24 py-2 font-normal" maxLength={400} value={bio} onChange={(e) => setBio(e.target.value)} /></label>
      <label className={field}>Tags (comma separated, up to 6)<input className="input mt-2 font-normal" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="MTH 201, Football" /></label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Usually free</legend>
        <div className="flex flex-wrap gap-2">
          {meta.freeTimes.map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={freeSel.includes(t)}
              onClick={() => setFreeSel(freeSel.includes(t) ? freeSel.filter((x) => x !== t) : [...freeSel, t])}>{t}</button>
          ))}
        </div>
        <label className="block text-sm text-ink-2">Anything else (optional)
          <input className="input mt-1 font-normal" maxLength={80} value={freeNote} onChange={(e) => setFreeNote(e.target.value)} placeholder="Free after 6 PM on Fridays" /></label>
        <p className={`text-xs ${usuallyFree.length > MAX_FREE ? 'text-danger' : 'text-ink-2'}`}>{usuallyFree.length}/{MAX_FREE}{usuallyFree.length > MAX_FREE ? ' characters. Remove a choice or shorten the note.' : ''}</p>
      </fieldset>
      <label className={field}>Usual spot
        <select className="input mt-2 font-normal" value={usualSpot} onChange={(e) => setSpot(e.target.value)}>
          <option value="">No fixed spot</option>{spotOptions.map((s) => <option key={s}>{s}</option>)}
        </select></label>
      {mode === 'romance' && (
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={hide} onChange={(e) => setHide(e.target.checked)} />Hide my Romance profile from students in my department</label>
      )}
      {save.isError && <p role="alert" className="text-sm text-danger">Could not save. Check the fields and try again.</p>}
      {isDirty && <p className="text-sm text-ink-2" role="status">You have unsaved changes to your {mode} profile.</p>}
      <span className="sr-only" role="status" aria-live="polite">{save.isSuccess && !isDirty ? `${mode} profile saved` : ''}</span>
      <button className="btn btn-i w-full" disabled={save.isPending || usuallyFree.length > MAX_FREE} onClick={() => save.mutate()}>{save.isSuccess && !isDirty ? 'Saved' : `Save ${mode} profile`}</button>
    </section>
  )
}

function BlockedList() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['blocks'], queryFn: () => unwrap(api.blocks.get()) })
  const unblock = useMutation({ mutationFn: (id: string) => unwrap(api.blocks({ userId: id }).delete()), onSuccess: () => qc.invalidateQueries() })
  const blocked = list.data?.blocked ?? []
  return (
    <section className="card space-y-3">
      <span className="label">Blocked students</span>
      {list.isLoading ? <LoadingRegion label="Loading blocked students"><BlockedListSkeleton /></LoadingRegion> : blocked.length === 0 ? <p className="text-sm text-ink-2">You have not blocked anyone.</p> : (
        <ul className="space-y-2">
          {blocked.map((b) => (
            <li key={b.id} className="flex items-center gap-3">
              <span className="flex-1 text-sm"><b>{b.name}</b> <span className="text-ink-2">{b.level}L {deptLabel(b.department)}</span></span>
              <button className="btn btn-ghost h-10 px-3" disabled={unblock.isPending} onClick={() => unblock.mutate(b.id)}>Unblock</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
/** Split a stored "usually free" line into the presets it contains (in preset order) and the leftover note. */
function splitFree(value: string, presets: readonly string[]) {
  const items = value.split(',').map((s) => s.trim()).filter(Boolean)
  return {
    selected: presets.filter((p) => items.some((i) => eq(i, p))) as string[],
    note: items.filter((i) => !presets.some((p) => eq(i, p))).join(', '),
  }
}
const composeFree = (selected: string[], note: string, presets: readonly string[]) =>
  [...presets.filter((p) => selected.includes(p)), note.trim()].filter(Boolean).join(', ')
