import { adminData } from '~/lib/admin-api'
import { nf, when } from '~/lib/format'
import { BroadcastForm } from './BroadcastForm'

type Item = { id: string; admin: string | null; title: string; body: string; university: string | null; department: string | null; students: number; devices: number; delivered: number; createdAt: string }
type Data = { items: Item[]; campuses: { slug: string; name: string }[]; departments: { name: string; university: string }[] }

export default async function Announcements() {
  const { items, campuses, departments } = await adminData<Data>('/admin/broadcasts')
  const name = (slug: string | null) => (slug ? campuses.find((c) => c.slug === slug)?.name ?? slug : 'All campuses')
  return (
    <>
      <div><h1 className="text-2xl font-bold">Announcements</h1><p className="text-sm text-ink-2">Send a push notification to students who have notifications turned on, for example an announcement or a nudge to come back and meet someone. Students who have not turned them on will not see it.</p></div>
      <BroadcastForm campuses={campuses} departments={departments} />
      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-lg font-semibold">Sent recently</h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead><tr className="label"><th className="p-3 font-medium">When</th><th className="p-3 font-medium">Message</th><th className="p-3 font-medium">Sent by</th><th className="p-3 font-medium">Audience</th><th className="p-3 font-medium">Students</th><th className="p-3 font-medium">Devices</th><th className="p-3 font-medium">Delivered</th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap p-3 text-xs">{when(i.createdAt)}</td>
                <td className="p-3"><b>{i.title}</b><div className="max-w-md text-ink-2">{i.body}</div></td>
                <td className="p-3 text-xs">{i.admin ?? <span className="text-ink-3">unknown</span>}</td>
                <td className="p-3 text-xs">{name(i.university)}{i.department ? `, ${i.department}` : ''}</td>
                <td className="p-3 tabular-nums">{nf.format(i.students)}</td><td className="p-3 tabular-nums">{nf.format(i.devices)}</td><td className="p-3 tabular-nums">{nf.format(i.delivered)}</td>
              </tr>))}
              {items.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-ink-2">Nothing sent yet.</td></tr>}</tbody>
          </table>
        </div>
      </section>
    </>
  )
}
