'use server'
import { revalidatePath } from 'next/cache'
import { adminApi } from '~/lib/admin-api'

export type Kind = 'departments' | 'spots'
export type Result = { error?: string }

const MESSAGES: Record<string, string> = {
  invalid_name: 'Use 2 to 60 letters, numbers or common punctuation (. , \' & ( ) / -).',
  duplicate: 'That name already exists for the same campus choice.',
  in_use: 'Students still have this. Archive it instead, so it stops being offered.',
  not_found: 'This entry no longer exists. Refresh the page.',
  already_exists: 'A department with this name already exists for that campus. Choose "Use existing" instead.',
  already_resolved: 'Someone already decided this request. Refresh the page.',
  department_required: 'Choose which department to use.',
  department_not_applicable: 'That department is not available to this campus.',
}
const fail = (data: { error?: string } | undefined): Result => ({ error: MESSAGES[data?.error ?? ''] ?? 'Could not save. Try again.' })
const UUID = /^[0-9a-f-]{36}$/i

// Server actions are public endpoints, so the arguments are checked here as well as by the API.
const okKind = (k: string): k is Kind => k === 'departments' || k === 'spots'

export async function createItem(kind: Kind, name: string, university: string): Promise<Result> {
  if (!okKind(kind)) return { error: 'Unknown list.' }
  const r = await adminApi(`/admin/${kind}`, { body: { name, university: university || null } })
  if (!r.ok) return fail(r.data)
  revalidatePath(`/${kind}`)
  return {}
}

export async function updateItem(kind: Kind, id: string, patch: { name?: string; active?: boolean }): Promise<Result> {
  if (!okKind(kind) || !UUID.test(id)) return { error: 'Unknown entry.' }
  const r = await adminApi(`/admin/${kind}/${id}`, { method: 'PATCH', body: patch })
  if (!r.ok) return fail(r.data)
  revalidatePath(`/${kind}`)
  return {}
}

export async function deleteItem(kind: Kind, id: string): Promise<Result> {
  if (!okKind(kind) || !UUID.test(id)) return { error: 'Unknown entry.' }
  const r = await adminApi(`/admin/${kind}/${id}`, { method: 'DELETE' })
  if (!r.ok) return fail(r.data)
  revalidatePath(`/${kind}`)
  return {}
}

export type ResolveInput =
  | { requestId: string; action: 'approve'; name: string; scope: 'campus' | 'all' }
  | { requestId: string; action: 'merge'; departmentId: string }
  | { requestId: string; action: 'decline'; note: string }

export async function resolveDepartmentRequest(input: ResolveInput): Promise<Result> {
  if (!UUID.test(input.requestId) || !['approve', 'merge', 'decline'].includes(input.action)) return { error: 'Unknown request.' }
  if (input.action === 'merge' && !UUID.test(input.departmentId)) return { error: MESSAGES.department_required }
  const r = await adminApi('/admin/department-requests/resolve', { body: input })
  if (!r.ok) return fail(r.data)
  revalidatePath('/departments'); revalidatePath('/', 'layout')
  return {}
}
