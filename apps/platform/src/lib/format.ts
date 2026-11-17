export const nf = new Intl.NumberFormat('en')
export function ago(iso: string | Date | null | undefined) {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
export const when = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }) : '-'
export const title = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
