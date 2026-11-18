import Link from 'next/link'
import { adminData } from '~/lib/admin-api'
import { when } from '~/lib/format'

type U = { id: string; name: string; department: string; level: number; university: string; status: string; emailMasked: string; createdAt: string }

export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; deleted?: string }> }) {
  const { q = '', status, deleted } = await searchParams
  const qs = new URLSearchParams({ ...(q && { q }), ...(status === 'suspended' && { status }) }).toString()
  const { users } = await adminData<{ users: U[] }>(`/admin/users${qs ? `?${qs}` : ''}`)
  return (
    <>
      {deleted === '1' && <p role="status" className="card text-sm">The account was deleted. It is recorded in the audit log.</p>}
      <div><h1 className="text-2xl font-bold">Students</h1><p className="text-sm text-ink-2">Search by name, email or ID. Searches and profile views are recorded in the audit log.</p></div>
      <form className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Name, email or ID" aria-label="Search students" className="input max-w-sm" />
        <select name="status" defaultValue={status ?? ''} aria-label="Status" className="input w-40"><option value="">All</option><option value="suspended">Suspended</option></select>
        <button className="btn">Search</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead><tr className="label"><th className="p-3 font-medium">Student</th><th className="p-3 font-medium">Campus</th><th className="p-3 font-medium">Email</th><th className="p-3 font-medium">Joined</th><th className="p-3 font-medium">Status</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="p-3"><Link href={`/users/${u.id}`} className="font-semibold underline underline-offset-2">{u.name}</Link><div className="text-xs text-ink-2">{u.department} {u.level}L</div></td>
                <td className="p-3 capitalize">{u.university}</td><td className="p-3 font-mono text-xs">{u.emailMasked}</td><td className="p-3 text-xs">{when(u.createdAt)}</td>
                <td className="p-3">{u.status === 'suspended' ? <span className="badge text-danger">Suspended</span> : <span className="badge">Active</span>}</td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-ink-2">No students found.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-2">Showing the 25 most recent matches.</p>
    </>
  )
}
