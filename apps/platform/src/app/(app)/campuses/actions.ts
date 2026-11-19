'use server'
import { revalidatePath } from 'next/cache'
import { adminApi } from '~/lib/admin-api'

export type Result = { error?: string }

const MESSAGES: Record<string, string> = {
  invalid_slug: 'The short name must be 2 to 40 lowercase letters, numbers or single hyphens: the part of the email domain just before .edu.ng.',
  invalid_name: 'Use 2 to 60 letters, numbers or common punctuation (. , \' & ( ) / -).',
  exists: 'This university is already on the list.',
  not_found: 'This university no longer exists. Refresh the page.',
}
const fail = (data: { error?: string } | undefined, slug = ''): Result => ({
  error: data?.error === 'invalid_email_domain'
    ? `Each email domain must belong to this university and end in ${slug || 'its short name'}.edu.ng, for example st.${slug || 'name'}.edu.ng. At most 5.`
    : MESSAGES[data?.error ?? ''] ?? 'Could not save. Try again.',
})

// Server actions are public endpoints, so the arguments are checked here as well as by the API.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** "st.abu.edu.ng, students.abu.edu.ng" -> a list. The API tidies and validates each one. */
const split = (raw: string) => raw.split(/[\s,;]+/).filter(Boolean)
const okText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max

export async function openCampus(input: { name: string; slug: string; domains: string; fromTemplate: boolean }): Promise<Result> {
  if (!okText(input?.name, 120) || !okText(input?.slug, 60) || !okText(input?.domains, 600)) return { error: 'Invalid input.' }
  const slug = input.slug.trim().toLowerCase()
  if (!SLUG.test(slug) || slug.length < 2 || slug.length > 40) return { error: MESSAGES.invalid_slug }
  const r = await adminApi('/admin/campuses', { body: { name: input.name, slug, emailDomains: split(input.domains), fromTemplate: !!input.fromTemplate } })
  if (!r.ok) return fail(r.data, slug)
  revalidatePath('/campuses')
  return {}
}

export async function updateCampus(slug: string, patch: { name?: string; open?: boolean; domains?: string }): Promise<Result> {
  if (!okText(slug, 60) || !SLUG.test(slug)) return { error: 'Unknown university.' }
  if (patch?.name !== undefined && !okText(patch.name, 120)) return { error: 'Invalid name.' }
  if (patch?.domains !== undefined && !okText(patch.domains, 600)) return { error: 'Invalid domains.' }
  const body = { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.open !== undefined ? { open: !!patch.open } : {}), ...(patch.domains !== undefined ? { emailDomains: split(patch.domains) } : {}) }
  const r = await adminApi(`/admin/campuses/${slug}`, { method: 'PATCH', body })
  if (!r.ok) return fail(r.data, slug)
  revalidatePath('/campuses')
  return {}
}
