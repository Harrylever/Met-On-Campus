'use server'
import { revalidatePath } from 'next/cache'
import { adminApi } from '~/lib/admin-api'

export type State = { error?: string; done?: boolean } | undefined
export async function setSuspension(userId: string, suspend: boolean, _: State, fd: FormData): Promise<State> {
  const note = String(fd.get('note') ?? '').trim()
  if (note.length < 5) return { error: 'Add a short written reason (at least 5 characters).' }
  if (suspend && fd.get('confirm') !== 'on') return { error: 'Tick the box to confirm.' }
  const r = await adminApi(`/admin/users/${userId}/${suspend ? 'suspend' : 'unsuspend'}`, { body: { note } })
  if (!r.ok) return { error: 'Could not save. Try again.' }
  revalidatePath(`/users/${userId}`); revalidatePath('/users')
  return { done: true }
}
