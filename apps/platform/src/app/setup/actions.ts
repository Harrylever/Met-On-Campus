'use server'
import QRCode from 'qrcode'
import { rawAdminApi } from '~/lib/admin-api'

export async function beginSetup(token: string, password: string): Promise<{ error: string } | { secret: string; qrSvg: string }> {
  const r = await rawAdminApi('/admin/auth/setup/begin', { body: { token, password } })
  if (r.status === 429) return { error: 'Too many attempts. Wait a few minutes and try again.' }
  if (r.status === 422) return { error: r.data?.message ?? 'That password is too weak.' }
  if (!r.ok) return { error: 'This setup link is invalid or has expired. Ask for a new one.' }
  // Rendered here so the secret is never sent to a third-party QR service.
  const qrSvg = await QRCode.toString(r.data.otpauthUri, { type: 'svg', margin: 1, width: 192 })
  return { secret: r.data.secret, qrSvg }
}

export async function confirmSetup(token: string, code: string): Promise<{ error: string } | { backupCodes: string[] }> {
  const r = await rawAdminApi('/admin/auth/setup/confirm', { body: { token, code } })
  if (r.status === 422) return { error: 'That code did not match. Check the time on your phone and try the next code.' }
  if (r.status === 429) return { error: 'Too many attempts. Wait a few minutes and try again.' }
  if (!r.ok) return { error: 'This setup link is invalid or has expired. Ask for a new one.' }
  return { backupCodes: r.data.backupCodes }
}
