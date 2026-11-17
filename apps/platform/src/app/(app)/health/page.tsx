import { adminData } from '~/lib/admin-api'
import { BarChart, Stat } from '~/components/Charts'
import { recentDeployments } from '~/lib/railway'
import { ago, nf } from '~/lib/format'

type Health = { api: { uptimeSeconds: number; runtime: string; memoryMb: number }; postgres: { ok: boolean; ms: number | null }; redis: { ok: boolean; ms: number | null }
  requests: { lastHour: number; serverErrors: number; errorRate: number; perMinute: { t: number; requests: number; serverErrors: number }[] } }
const up = (s: number) => s > 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : s > 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`
const dep: Record<string, string> = { SUCCESS: 'text-ok', FAILED: 'text-danger', CRASHED: 'text-danger', BUILDING: 'text-warn', DEPLOYING: 'text-warn', REMOVED: 'text-ink-3', SKIPPED: 'text-ink-3' }

export default async function HealthPage() {
  const [h, railway] = await Promise.all([adminData<Health>('/admin/health'), recentDeployments()])
  const mins = h.requests.perMinute
  const Dot = ({ ok }: { ok: boolean }) => <span className={ok ? 'text-ok' : 'text-danger'}>{ok ? '● Healthy' : '▲ Down'}</span>
  return (
    <>
      <div><h1 className="text-2xl font-bold">Service health</h1><p className="text-sm text-ink-2">Checked live when you open this page.</p></div>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="API" value={up(h.api.uptimeSeconds)} note={`up · ${h.api.runtime} · ${h.api.memoryMb} MB`} />
        <div className="card"><p className="label">Postgres</p><p className="mt-1 text-lg font-semibold"><Dot ok={h.postgres.ok} /></p><p className="text-xs text-ink-2">{h.postgres.ms ?? '-'} ms</p></div>
        <div className="card"><p className="label">Redis</p><p className="mt-1 text-lg font-semibold"><Dot ok={h.redis.ok} /></p><p className="text-xs text-ink-2">{h.redis.ms ?? '-'} ms</p></div>
        <Stat label="Server errors (1h)" value={`${(h.requests.errorRate * 100).toFixed(2)}%`} tone={h.requests.errorRate > 0.01 ? 'danger' : undefined} note={`${nf.format(h.requests.serverErrors)} of ${nf.format(h.requests.lastHour)} requests`} />
      </section>
      <BarChart title="API requests per minute (last hour)" unit="requests"
        data={mins.map((m) => ({ label: new Date(m.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }), value: m.requests }))}
        errors={mins.map((m) => m.serverErrors)} />
      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">Recent deployments</h2>
        {!railway.configured ? <p className="text-sm text-ink-2">Not connected. Set <code className="font-mono">RAILWAY_API_TOKEN</code>, <code className="font-mono">RAILWAY_PROJECT_ID</code>, <code className="font-mono">RAILWAY_ENVIRONMENT_ID</code> and <code className="font-mono">RAILWAY_SERVICE_ID</code> on this app to list them here.</p>
          : railway.error ? <p role="alert" className="text-sm text-danger">Could not load deployments: {railway.error}</p>
          : <ul className="divide-y divide-line text-sm">{railway.deployments.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2"><span className={`w-24 font-mono text-xs font-semibold ${dep[d.status] ?? ''}`}>{d.status === 'SUCCESS' ? '● ' : d.status === 'FAILED' || d.status === 'CRASHED' ? '▲ ' : '○ '}{d.status}</span>
                <span className="font-mono text-xs text-ink-2">{d.commit ?? '-'}</span><span className="min-w-0 flex-1 truncate">{d.message ?? ''}</span><span className="text-xs text-ink-2">{ago(d.createdAt)}</span></li>))}</ul>}
      </section>
    </>
  )
}
