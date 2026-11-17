import { AuthShell } from '~/components/ui'
import { rawAdminApi } from '~/lib/admin-api'
import { SetupFlow } from './SetupFlow'

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  const check = token ? await rawAdminApi('/admin/auth/setup/check', { body: { token } }) : null
  if (!token || !check?.ok) {
    return <AuthShell title="Link not valid"><p className="text-sm text-ink-2">This setup link is invalid, already used, or has expired. Ask the person who runs the platform for a new one.</p></AuthShell>
  }
  return <SetupFlow token={token} email={check.data.email} />
}
