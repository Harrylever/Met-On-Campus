import { NextResponse } from 'next/server'
import { rawAdminApi } from '~/lib/admin-api'
import { sessionToken } from '~/lib/session'

// Polled by the Activity page. Same rules as everything else: no cookie, no data.
export async function GET() {
  const session = await sessionToken()
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const r = await rawAdminApi('/admin/activity', { session })
  return NextResponse.json(r.data, { status: r.status, headers: { 'cache-control': 'no-store' } })
}
