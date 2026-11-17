import { adminData } from '~/lib/admin-api'
import { when } from '~/lib/format'

type E = { id: string; at: string; admin: string | null; action: string; targetType: string | null; targetId: string | null; meta: string | null; ip: string | null }
export default async function Audit() {
  const { entries } = await adminData<{ entries: E[] }>('/admin/audit?limit=200')
  return (
    <>
      <div><h1 className="text-2xl font-bold">Audit log</h1><p className="text-sm text-ink-2">Every sign-in, search, profile view and moderation action by staff. Append-only.</p></div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead><tr className="label"><th className="p-3 font-medium">When</th><th className="p-3 font-medium">Who</th><th className="p-3 font-medium">Action</th><th className="p-3 font-medium">Target</th><th className="p-3 font-medium">IP</th></tr></thead>
          <tbody>{entries.map((e) => (
            <tr key={e.id} className="border-t border-line align-top"><td className="whitespace-nowrap p-3 text-xs">{when(e.at)}</td><td className="p-3 text-xs">{e.admin ?? <span className="text-ink-3">unknown</span>}</td>
              <td className="p-3 font-mono text-xs">{e.action}{e.meta && <div className="max-w-xs truncate text-ink-3" title={e.meta}>{e.meta}</div>}</td>
              <td className="p-3 font-mono text-xs">{e.targetType ? `${e.targetType}:${e.targetId?.slice(0, 8)}` : ''}</td><td className="p-3 font-mono text-xs">{e.ip}</td></tr>))}
          </tbody>
        </table>
      </div>
    </>
  )
}
