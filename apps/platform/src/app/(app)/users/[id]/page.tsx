import Link from 'next/link'
import { notFound } from 'next/navigation'
import { adminApi } from '~/lib/admin-api'
import { ago, title, when } from '~/lib/format'
import { SuspensionForm } from './SuspensionForm'

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const r = await adminApi(`/admin/users/${id}`)
  if (r.status === 404) notFound()
  if (!r.ok) throw new Error(`API returned ${r.status}`)
  const d = r.data
  const u = d.user, a = d.activity, s = d.safety
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-4 border-t border-line py-2 text-sm first:border-t-0"><dt className="text-ink-2">{k}</dt><dd className="text-right tabular-nums">{v}</dd></div>
  return (
    <>
      <div><Link href="/users" className="text-sm text-ink-2 underline underline-offset-2">← Students</Link></div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{u.name}</h1>
        {u.status === 'suspended' ? <span className="badge text-danger">Suspended</span> : <span className="badge">Active</span>}
      </div>
      <p className="text-sm text-ink-2">Viewing this profile is recorded in the audit log. Private messages are not available here.</p>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card"><h2 className="mb-2 text-lg font-semibold">Identity</h2><dl>
          <Row k="Email" v={<span className="font-mono text-xs">{u.email}</span>} /><Row k="Campus" v={<span className="capitalize">{u.university}</span>} />
          <Row k="Department" v={`${u.department} ${u.level}L`} /><Row k="Joined" v={when(u.createdAt)} />
          {u.suspendedAt && <Row k="Suspended" v={`${when(u.suspendedAt)}: ${u.suspendedReason}`} />}</dl></section>
        <section className="card"><h2 className="mb-2 text-lg font-semibold">Activity</h2><dl>
          <Row k="Messages sent" v={a.messagesSent} /><Row k="Last message" v={ago(a.lastMessageAt)} />
          <Row k="Connections sent / received" v={`${a.connectionsSent} / ${a.connectionsReceived}`} />
          <Row k="Conversations" v={Object.entries(a.conversations).map(([k, v]) => `${title(k)} ${v}`).join(', ') || 'none'} />
          <Row k="Rooms hosted / joined" v={`${a.roomsHosted} / ${a.roomsJoined}`} /><Row k="Active sessions" v={a.activeSessions} /></dl></section>
        <section className="card"><h2 className="mb-2 text-lg font-semibold">Modes</h2>
          {d.profiles.length === 0 ? <p className="text-sm text-ink-2">No profiles.</p> : <ul className="space-y-2 text-sm">
            {d.profiles.map((p: any) => <li key={p.intent}><b>{title(p.intent)}</b> <span className="text-ink-2">{p.enabled ? 'on' : 'off'}</span>{p.prompt && <p className="text-ink-2">“{p.prompt}”</p>}{p.tags.length > 0 && <p className="text-xs text-ink-2">{p.tags.join(', ')}</p>}</li>)}</ul>}</section>
        <section className="card"><h2 className="mb-2 text-lg font-semibold">Safety</h2><dl>
          <Row k="Blocked by this student" v={s.blocksGiven} /><Row k="Blocked this student" v={s.blocksReceived} /><Row k="Reports filed" v={s.reportsFiled} /><Row k="Reports against" v={d.reportsAgainst.length} /></dl></section>
      </div>

      <section className="card"><h2 className="mb-3 text-lg font-semibold">Reports against</h2>
        {d.reportsAgainst.length === 0 ? <p className="text-sm text-ink-2">None.</p> : <ul className="space-y-1 text-sm">{d.reportsAgainst.map((x: any) => <li key={x.id}>{title(x.reason)} <span className="badge ml-2">{title(x.status)}</span> <span className="text-xs text-ink-2">{when(x.createdAt)}</span></li>)}</ul>}</section>
      <section className="card"><h2 className="mb-3 text-lg font-semibold">Moderation history</h2>
        {d.moderation.length === 0 ? <p className="text-sm text-ink-2">No actions taken.</p> : <ul className="space-y-2 text-sm">{d.moderation.map((m: any) => <li key={m.id}><b>{title(m.action)}</b> <span className="text-xs text-ink-2">{when(m.createdAt)}</span><p className="text-ink-2">{m.note}</p></li>)}</ul>}</section>
      <section className="card"><h2 className="mb-3 text-lg font-semibold">{u.status === 'suspended' ? 'Restore account' : 'Suspend account'}</h2><SuspensionForm userId={u.id} name={u.name} suspended={u.status === 'suspended'} /></section>
    </>
  )
}
