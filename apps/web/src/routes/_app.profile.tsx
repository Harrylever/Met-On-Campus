import { useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, INTENTS, type Intent } from '~/lib/api'
import { IntentTabs } from '~/components/ui'

export const Route = createFileRoute('/_app/profile')({ component: Profile })

const DEPTS = ['Cyber Security', 'Computer Science', 'Information Technology', 'Electrical Engineering']

function Profile() {
  const { me } = Route.useRouteContext()
  const router = useRouter()
  const nav = useNavigate()
  const [mode, setMode] = useState<Intent>('study')
  const current = me.profiles.find((p) => p.intent === mode)

  const logout = useMutation({ mutationFn: () => unwrap(api.auth.logout.post()), onSuccess: () => nav({ to: '/login' }) })
  const [name, setName] = useState(me.user.name)
  const [department, setDepartment] = useState(me.user.department)
  const [level, setLevel] = useState(me.user.level)
  const saveBasics = useMutation({ mutationFn: () => unwrap(api.me.patch({ name, department, level })), onSuccess: () => router.invalidate() })

  return (
    <div data-intent={mode} className="flex flex-col gap-5">
      <h1 className="text-[28px] font-bold leading-[34px]">Your profiles</h1>

      <section className="card space-y-3">
        <span className="label">About you (shown on every mode)</span>
        <label className="block text-sm font-semibold">Name<input className="input mt-2 font-normal" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">Department
            <select className="input mt-2 h-11 font-normal" value={department} onChange={(e) => setDepartment(e.target.value)}>
              {[...new Set([department, ...DEPTS])].map((d) => <option key={d}>{d}</option>)}
            </select></label>
          <label className="block text-sm font-semibold">Level
            <select className="input mt-2 h-11 font-normal" value={level} onChange={(e) => setLevel(+e.target.value)}>{[100, 200, 300, 400, 500].map((l) => <option key={l} value={l}>{l}L</option>)}</select></label>
        </div>
        <button className="btn" disabled={saveBasics.isPending || !name.trim()} onClick={() => saveBasics.mutate()}>{saveBasics.isSuccess ? 'Saved' : 'Save'}</button>
      </section>

      <IntentTabs value={mode} onChange={setMode} options={INTENTS} />
      {/* key resets the form when switching modes so one mode's edits never bleed into another */}
      <ModeForm key={mode} mode={mode} profile={current} department={me.user.department} onSaved={() => router.invalidate()} />

      <button className="btn btn-ghost" onClick={() => logout.mutate()}>Sign out</button>
    </div>
  )
}

type P = NonNullable<ReturnType<typeof Route.useRouteContext>['me']['profiles'][number]>
function ModeForm({ mode, profile, onSaved }: { mode: Intent; profile?: P; department: string; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(profile?.enabled ?? false)
  const [prompt, setPrompt] = useState(profile?.prompt ?? '')
  const [bio, setBio] = useState(profile?.bio ?? '')
  const [tags, setTags] = useState((profile?.tags ?? []).join(', '))
  const [usuallyFree, setFree] = useState(profile?.usuallyFree ?? '')
  const [usualSpot, setSpot] = useState(profile?.usualSpot ?? '')
  const [hide, setHide] = useState(profile?.hideFromDepartment ?? true)
  const spots = useQuery({ queryKey: ['spots'], queryFn: () => unwrap(api.spots.get()), staleTime: Infinity })
  const qc = useQueryClient()

  const save = useMutation({
    mutationFn: () => unwrap(api.me.profiles({ intent: mode }).put({
      enabled, prompt, bio, usuallyFree, usualSpot,
      tags: tags.split(",").map((t: string) => t.trim()).filter(Boolean).slice(0, 6),
      ...(mode === 'romance' ? { hideFromDepartment: hide } : {}),
    })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['discover'] }); onSaved() },
  })
  const field = 'block text-sm font-semibold'
  return (
    <section className="card space-y-4 border-(--i-line) bg-(--i-bg)">
      <label className="flex items-center justify-between gap-3 font-semibold">
        <span>{mode[0]!.toUpperCase() + mode.slice(1)} Mode is {enabled ? 'on' : 'off'}</span>
        <input type="checkbox" role="switch" className="size-6" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      </label>
      <label className={field}>Prompt<input className="input mt-2 font-normal" maxLength={160} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="One line that starts a conversation" /></label>
      <label className={field}>About<textarea className="input mt-2 h-24 py-2 font-normal" maxLength={400} value={bio} onChange={(e) => setBio(e.target.value)} /></label>
      <label className={field}>Tags (comma separated, up to 6)<input className="input mt-2 font-normal" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="CSS 411, Football" /></label>
      <label className={field}>Usually free<input className="input mt-2 font-normal" maxLength={80} value={usuallyFree} onChange={(e) => setFree(e.target.value)} placeholder="Weekdays after 2:00 PM" /></label>
      <label className={field}>Usual spot
        <select className="input mt-2 font-normal" value={usualSpot} onChange={(e) => setSpot(e.target.value)}>
          <option value="">No fixed spot</option>{spots.data?.spots.map((s) => <option key={s}>{s}</option>)}
        </select></label>
      {mode === 'romance' && (
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={hide} onChange={(e) => setHide(e.target.checked)} />Hide my Romance profile from students in my department</label>
      )}
      {save.isError && <p role="alert" className="text-sm text-danger">Could not save. Check the fields and try again.</p>}
      <button className="btn btn-i w-full" disabled={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? 'Saved' : 'Save profile'}</button>
    </section>
  )
}
