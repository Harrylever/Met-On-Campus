import Link from 'next/link'
import { adminData } from '~/lib/admin-api'
import { logoutAction } from '../login/actions'
import { Brand } from '~/components/ui'
import { NavLink } from './NavLink'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await adminData<{ email: string; backupCodesLeft: number; openReports: number }>('/admin/me')
  const nav = [
    { href: '/', label: 'Overview' },
    { href: '/reports', label: 'Reports', badge: me.openReports },
    { href: '/users', label: 'Users' },
    { href: '/activity', label: 'Activity' },
    { href: '/health', label: 'Health' },
    { href: '/audit', label: 'Audit log' },
  ]
  return (
    <div className="mx-auto flex min-h-dvh max-w-7xl flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 border-b border-line p-4 md:w-56 md:border-b-0 md:border-r">
        <Link href="/" aria-label="Overview"><Brand small /></Link>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-col">
          {nav.map((n) => <NavLink key={n.href} {...n} />)}
        </nav>
        <div className="mt-auto hidden space-y-2 text-xs text-ink-2 md:block">
          <p className="break-all">{me.email}</p>
          <form action={logoutAction}><button className="underline underline-offset-2">Sign out</button></form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 space-y-5 p-4 md:p-6">
        {me.backupCodesLeft <= 3 && (
          <p role="status" className="rounded-lg border border-line bg-subtle p-3 text-sm">
            You have {me.backupCodesLeft} backup code{me.backupCodesLeft === 1 ? '' : 's'} left. Ask for a reset invite to get a fresh set.
          </p>
        )}
        {children}
        <form action={logoutAction} className="md:hidden"><button className="btn btn-ghost">Sign out ({me.email})</button></form>
      </main>
    </div>
  )
}
