'use server'
import { revalidatePath } from 'next/cache'
import { adminApi } from '~/lib/admin-api'

export type Result = { error?: string }
const MESSAGES: Record<string, string> = {
  not_found: 'This photo no longer exists. Refresh the page.',
  already_resolved: 'Someone already decided this photo. Refresh the page.',
}

export async function resolvePhoto(input: { photoId: string; action: 'approve' | 'reject' | 'remove'; note?: string }): Promise<Result> {
  if (!/^[0-9a-f-]{36}$/i.test(input.photoId) || !['approve', 'reject', 'remove'].includes(input.action)) return { error: 'Unknown photo.' }
  const r = await adminApi<{ error?: string }>('/admin/photos/resolve', { body: { photoId: input.photoId, action: input.action, note: input.note?.slice(0, 200) } })
  if (!r.ok) return { error: MESSAGES[r.data?.error ?? ''] ?? 'Could not save. Try again.' }
  revalidatePath('/photos'); revalidatePath('/', 'layout')
  return {}
}
