import { cookies } from 'next/headers'
import { adminData } from '~/lib/admin-api'
import { logoutAction } from '../login/actions'
import { Brand } from '~/components/ui'
import { Sidebar, type NavItem } from './Sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await adminData<{ email: string; backupCodesLeft: number; openReports: number; departmentRequests: number }>('/admin/me')
  const collapsed = (await cookies()).get('moc_sidebar')?.value === '1'
  const items: NavItem[] = [
    { href: '/', label: 'Overview', icon: 'overview' },
    { href: '/reports', label: 'Reports', icon: 'reports', badge: me.openReports },
    { href: '/users', label: 'Users', icon: 'users' },
    { href: '/departments', label: 'Departments', icon: 'departments', badge: me.departmentRequests },
    { href: '/spots', label: 'Campus spots', icon: 'spots' },
    { href: '/activity', label: 'Activity', icon: 'activity' },
    { href: '/health', label: 'Health', icon: 'health' },
    { href: '/audit', label: 'Audit log', icon: 'audit' },
  ]
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar items={items} email={me.email} initialCollapsed={collapsed} signOut={logoutAction}
        brand={<Brand small />} brandMark={<Brand mark />} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-6">
          {me.backupCodesLeft <= 3 && (
            <p role="status" className="rounded-lg border border-line bg-subtle p-3 text-sm">
              You have {me.backupCodesLeft} backup code{me.backupCodesLeft === 1 ? '' : 's'} left. Ask for a reset invite to get a fresh set.
            </p>
          )}
          {children}
          <form action={logoutAction} className="md:hidden"><button className="btn btn-ghost">Sign out ({me.email})</button></form>
        </div>
      </main>
    </div>
  )
}
