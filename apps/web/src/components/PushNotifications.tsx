import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, unwrap } from '~/lib/api'
import { disablePush, enablePush, pushSupported, thisDevice } from '~/lib/push'
import { isIOS, isStandalone } from '~/lib/pwa'

/** Profile card: notifications on this device. A tap asks the browser for permission; the sample notification confirms it works. */
export function PushNotifications() {
  const server = useQuery({ queryKey: ['push-key'], queryFn: () => unwrap(api.push.key.get()), staleTime: 300_000 })
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')

  useEffect(() => {
    if (!pushSupported()) { setOn(false); return }
    setPermission(Notification.permission)
    thisDevice().then((s) => setOn(!!s && Notification.permission === 'granted')).catch(() => setOn(false))
  }, [])

  // iPhones only allow notifications from an app that has been added to the home screen.
  const needsInstall = isIOS() && !isStandalone()
  if (server.data && !server.data.enabled) return null
  const supported = pushSupported()

  const turnOn = async () => {
    setBusy(true); setNote(null)
    try {
      const r = await enablePush(server.data!.publicKey!)
      setPermission(Notification.permission)
      if (r === 'on') setOn(true); else setNote('Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.')
    } catch { setNote('We could not turn notifications on. Try again.') } finally { setBusy(false) }
  }
  const turnOff = async () => { setBusy(true); setNote(null); try { await disablePush(); setOn(false) } catch { setNote('Could not turn it off. Try again.') } finally { setBusy(false) } }
  const test = async () => {
    setBusy(true); setNote(null)
    try { const r = await unwrap(api.me.push.test.post()); setNote(r.delivered ? 'Sent. It should appear in a moment.' : 'Nothing was delivered. Turn it off and on again.') }
    catch { setNote('Could not send a test. Try again in a few minutes.') } finally { setBusy(false) }
  }

  return (
    <section className="card space-y-2" aria-labelledby="push-heading">
      <label className="flex items-center justify-between gap-4">
        <span id="push-heading" className="text-[17px] font-semibold">Notifications on this device</span>
        <input type="checkbox" role="switch" className="size-6 shrink-0" checked={!!on} disabled={busy || on === null || !supported || needsInstall || !server.data?.enabled}
          onChange={(e) => (e.target.checked ? turnOn() : turnOff())} />
      </label>
      <p className="text-sm text-ink-2">A short notification when you get an invite, a message or a room update, even when the app is closed. It never names anyone or any mode, so it is safe on a lock screen.</p>
      {needsInstall && <p className="rounded-[10px] bg-subtle p-3 text-sm">On iPhone, first add Met On Campus to your home screen (card above), open it from there, then turn this on.</p>}
      {!supported && !needsInstall && <p className="text-sm text-ink-2">This browser does not support notifications.</p>}
      {permission === 'denied' && !on && <p className="text-sm text-danger">Notifications are blocked for this site. Allow them in your browser or phone settings, then turn this on.</p>}
      {on && <button type="button" className="btn btn-ghost h-10 px-4" disabled={busy} onClick={test}>Send me a test notification</button>}
      {note && <p role="status" className="text-sm text-ink-2">{note}</p>}
    </section>
  )
}
