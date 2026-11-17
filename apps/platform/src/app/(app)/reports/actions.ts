'use server'
import { revalidatePath } from 'next/cache'
import { adminApi } from '~/lib/admin-api'

export type ResolveState = { error?: string; done?: boolean } | undefined

export async function resolveReport(reportId: string, _: ResolveState, fd: FormData): Promise<ResolveState> {
  const action = String(fd.get('action'))
  const note = String(fd.get('note') ?? '')
  if (!['dismiss', 'warn', 'suspend'].includes(action)) return { error: 'Choose an action.' }
  if (action === 'suspend' && fd.get('confirm') !== 'on') return { error: 'Tick the box to confirm the suspension.' }
  const r = await adminApi(`/admin/reports/${reportId}/resolve`, { body: { action, note } })
  if (r.status === 422) return { error: 'Add a short written reason (at least 5 characters).' }
  if (r.status === 409) { revalidatePath('/reports'); return { error: 'Someone else already resolved this report.' } }
  if (!r.ok) return { error: 'Could not save. Try again.' }
  revalidatePath('/reports'); revalidatePath('/', 'layout')
  return { done: true }
}
