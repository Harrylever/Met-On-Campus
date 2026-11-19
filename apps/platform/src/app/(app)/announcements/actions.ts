'use server'
import { revalidatePath } from 'next/cache'
import { adminApi } from '~/lib/admin-api'

const MESSAGES: Record<string, string> = {
  invalid_title: 'The title must be 1 to 50 characters.',
  invalid_body: 'The message must be 1 to 140 characters.',
  invalid_link: 'The link must be a page inside the app, like /discover (starting with a single "/", no spaces).',
  department_needs_campus: 'Choose a campus before choosing a department.',
  unknown_campus: 'That campus no longer exists. Refresh the page.',
  no_recipients: 'Nobody in this audience has notifications turned on, so nothing was sent.',
  duplicate_broadcast: 'This exact announcement was just sent. Change it, or wait a few minutes.',
  too_many_broadcasts: 'The limit is 5 announcements an hour. Try again later.',
  push_unavailable: 'Push notifications are not set up on the server.',
}
const fail = (data: { error?: string } | undefined) => ({ error: MESSAGES[data?.error ?? ''] ?? 'Could not send. Try again.' })

export type Audience = { university: string; department: string }

// Server actions are public endpoints: check the arguments here as well as in the API.
const text = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null)

export async function previewAudience(university: string, department: string): Promise<{ students?: number; devices?: number; error?: string }> {
  const u = text(university, 60), d = text(department, 120)
  if (u === null || d === null) return { error: 'Invalid audience.' }
  const r = await adminApi('/admin/broadcasts/preview', { body: { university: u || undefined, department: d || undefined } })
  if (!r.ok) return fail(r.data)
  return { students: r.data.students, devices: r.data.devices }
}

export async function sendBroadcast(input: { title: string; body: string; url: string } & Audience): Promise<{ error?: string; students?: number; devices?: number }> {
  const title = text(input?.title, 500), body = text(input?.body, 2000), url = text(input?.url, 500), u = text(input?.university, 60), d = text(input?.department, 120)
  if (title === null || body === null || url === null || u === null || d === null) return { error: 'Invalid announcement.' }
  const r = await adminApi('/admin/broadcasts', { body: { title, body, url: url || undefined, university: u || undefined, department: d || undefined } })
  if (!r.ok) return fail(r.data)
  revalidatePath('/announcements')
  return { students: r.data.students, devices: r.data.devices }
}
