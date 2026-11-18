import { api, unwrap } from '~/lib/api'

// Web push from the browser's side. Every function is safe to call when push is not supported: it just does nothing.
export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const toBytes = (b64url: string) => {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
const registration = () => navigator.serviceWorker.ready
export const thisDevice = async () => (pushSupported() ? (await registration()).pushManager.getSubscription() : null)

async function tellServer(sub: PushSubscription) {
  const json = sub.toJSON()
  await unwrap(api.me.push.post({ endpoint: sub.endpoint, keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! } }))
}

/** Asks permission (must be called from a tap), subscribes this device, and registers it with the server. */
export async function enablePush(publicKey: string): Promise<'on' | 'denied'> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const reg = await registration()
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) }))
  await tellServer(sub)
  return 'on'
}

/** Turns notifications off for this device only. */
export async function disablePush() {
  const sub = await thisDevice()
  if (!sub) return
  await unwrap(api.me.push.remove.post({ endpoint: sub.endpoint })).catch(() => {})
  await sub.unsubscribe()
}

/** On sign-in or app start: if this device already said yes, make sure the server knows it is this account's (a shared phone must not keep notifying the last person). */
export async function syncPush() {
  if (!pushSupported() || Notification.permission !== 'granted') return
  const sub = await thisDevice()
  if (sub) await tellServer(sub).catch(() => {})
}

/** On sign-out: this device stops getting the signed-out account's notifications. */
export async function forgetThisDevice() {
  try { await disablePush() } catch { /* signing out must never fail because of this */ }
}
