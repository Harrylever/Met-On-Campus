import { treaty } from '@elysiajs/eden'
import type { App } from '@moc/api' // type-only: no server code reaches the bundle

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
export const api = treaty<App>(API_URL, { fetch: { credentials: 'include' } })

export type Intent = 'study' | 'friends' | 'romance'
export const INTENTS: { id: Intent; label: string }[] = [
  { id: 'study', label: 'Study' }, { id: 'friends', label: 'Friends' }, { id: 'romance', label: 'Romance' },
]

/** Throw on Eden errors so TanStack Query handles them. */
export async function unwrap<T>(p: Promise<{ data: T | null; error: { status: unknown; value: unknown } | null }>): Promise<T> {
  const { data, error } = await p
  if (error || data == null) throw Object.assign(new Error('api_error'), { status: error?.status, value: error?.value })
  return data
}
