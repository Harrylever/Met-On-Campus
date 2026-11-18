'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
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

/** Delete an account on the student's request. Staff type the student's email and a reason; both are checked again by the API. */
export async function deleteUser(userId: string, _: State, fd: FormData): Promise<State> {
  const confirmEmail = String(fd.get('confirmEmail') ?? '').trim()
  const reason = String(fd.get('reason') ?? '').trim()
  if (!confirmEmail) return { error: 'Type the student\'s email address to confirm.' }
  if (reason.length < 5) return { error: 'Add a short written reason, such as how and when they asked.' }
  const r = await adminApi<{ error?: string }>(`/admin/users/${userId}/delete`, { body: { confirmEmail, reason } })
  if (!r.ok) return { error: r.data?.error === 'confirm_mismatch' ? 'That email does not match this student.' : r.data?.error === 'not_found' ? 'This account no longer exists.' : 'Could not delete. Try again.' }
  revalidatePath('/users')
  redirect('/users?deleted=1')
}

/** Undo an award (abuse or a mistake). Needs a written reason; the row stays on record, marked reversed. */
export async function reversePoints(eventId: string, userId: string, _: State, fd: FormData): Promise<State> {
  const note = String(fd.get('note') ?? '').trim()
  if (note.length < 5) return { error: 'Add a short written reason (at least 5 characters).' }
  const r = await adminApi<{ error?: string }>(`/admin/points/${eventId}/reverse`, { body: { note } })
  if (!r.ok) return { error: r.data?.error === 'already_reversed' ? 'This was already reversed. Refresh the page.' : 'Could not reverse it. Try again.' }
  revalidatePath(`/users/${userId}`)
  return { done: true }
}
