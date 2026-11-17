import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, unwrap, INTENTS, type Intent } from '~/lib/api'
import { Brand, VerifiedPill } from '~/components/ui'
import { DepartmentRequest } from '~/components/DepartmentRequest'

const NOT_LISTED = '__not_listed__'

export const Route = createFileRoute('/onboarding')({ ssr: false,
  beforeLoad: async () => {
    const { data } = await api.me.get()
    if (!data) throw redirect({ to: '/login' })
    return { me: data }
  },
  component: Onboarding,
})

const BLURB: Record<Intent, string> = {
  study: 'Study partners, group projects and course rooms.',
  friends: 'Clubs, sport, food and people to hang out with.',
  romance: 'Private by default. Shown only to students who also turned it on.',
}

function Onboarding() {
  const { me } = Route.useRouteContext()
  const nav = useNavigate()
  const [on, setOn] = useState<Record<Intent, boolean>>({ study: true, friends: false, romance: false })
  const [hideDept, setHideDept] = useState(true)
  // The department list is managed by staff and differs per campus, so it comes from the server.
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => unwrap(api.meta.get()) })
  const departments = meta.data?.departments ?? []
  const [chosenDept, setDepartment] = useState('')
  // "My department isn't listed": they can finish signing up once a request is sent, and show as "Department pending".
  const [notListed, setNotListed] = useState(false)
  const requests = useQuery({ queryKey: ['dept-requests'], queryFn: () => unwrap(api.me['department-requests'].get()) })
  const hasPending = !!requests.data?.requests.some((r) => r.status === 'pending')
  const department = notListed ? '' : chosenDept || departments[0] || ''
  const [level, setLevel] = useState(400)
  const any = Object.values(on).some(Boolean)

  const save = useMutation({
    mutationFn: async () => {
      await unwrap(api.me.patch(department ? { department, level } : { level }))
      await Promise.all(INTENTS.filter((i) => on[i.id]).map((i) =>
        unwrap(api.me.profiles({ intent: i.id }).put({ enabled: true, ...(i.id === 'romance' ? { hideFromDepartment: hideDept } : {}) }))))
    },
    onSuccess: () => nav({ to: '/discover' }),
  })

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 p-5">
      <header className="flex items-center justify-between"><Brand /><span className="label">Step 3 of 3</span></header>
      <VerifiedPill campus={me.user.university} />
      <div className="space-y-2">
        <h1 className="text-[28px] font-bold leading-[34px]">What are you here for</h1>
        <p className="text-ink-2">Turn on one or more. Each has its own profile and its own inbox, and they never mix.</p>
      </div>
      <div className="card overflow-hidden p-0">
        {INTENTS.map((i) => (
          <div key={i.id} data-intent={i.id} className="flex items-center gap-3 border-b border-line p-4 last:border-b-0" style={{ background: on[i.id] ? 'var(--i-bg)' : undefined }}>
            <div className="flex-1">
              <div className="flex items-center gap-2 font-semibold"><i className="size-2 rounded-full bg-(--i)" />Enable {i.label} Mode</div>
              <p className="text-[13px] text-ink-2">{BLURB[i.id]}</p>
            </div>
            <button role="switch" aria-checked={on[i.id]} aria-label={`Enable ${i.label} Mode`} onClick={() => setOn({ ...on, [i.id]: !on[i.id] })}
              className="relative h-7 w-12 shrink-0 rounded-full bg-ink-3 transition aria-checked:bg-(--i-ink)">
              <i className={`absolute top-0.5 size-6 rounded-full bg-white transition-all ${on[i.id] ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
        ))}
        {on.romance && (
          <label data-intent="romance" className="flex items-center gap-3 bg-romance-bg p-4 text-[13px]">
            <input type="checkbox" className="size-5" checked={hideDept} onChange={(e) => setHideDept(e.target.checked)} />
            Hide my Romance profile from students in my department
          </label>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-2 text-sm font-semibold">Department
          <select className="input mt-2 h-11 font-normal" value={notListed ? NOT_LISTED : department} onChange={(e) => { const v = e.target.value; setNotListed(v === NOT_LISTED); if (v !== NOT_LISTED) setDepartment(v) }}>{departments.length === 0 && <option value="">{meta.isError ? 'Could not load departments' : 'Loading…'}</option>}{departments.map((d) => <option key={d}>{d}</option>)}<option value={NOT_LISTED}>My department isn&apos;t listed</option></select>
        </label>
        <label className="space-y-2 text-sm font-semibold">Level
          <select className="input mt-2 h-11 font-normal" value={level} onChange={(e) => setLevel(+e.target.value)}>{[100, 200, 300, 400, 500].map((l) => <option key={l} value={l}>{l}L</option>)}</select>
        </label>
      </div>
      {notListed && <DepartmentRequest open />}
      <div className="mt-auto space-y-2">
        <button className="btn w-full" disabled={!any || !(department || hasPending) || save.isPending} onClick={() => save.mutate()}>Enter Campus</button>
        {!any && <p className="text-center text-[13px] text-ink-2">Turn on at least one mode to continue.</p>}
        {any && notListed && !hasPending && <p className="text-center text-[13px] text-ink-2">Send your department request above, then you can enter.</p>}
      </div>
    </main>
  )
}
