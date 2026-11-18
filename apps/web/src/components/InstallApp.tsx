import { useState } from 'react'
import { useInstall } from '~/lib/pwa'

const SHARE_STEPS = (
  <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
    <li>Tap the <b>Share</b> button in Safari (the square with an arrow).</li>
    <li>Scroll and tap <b>Add to Home Screen</b>.</li>
    <li>Tap <b>Add</b>. Open Met On Campus from your home screen.</li>
  </ol>
)

/** Profile card: add Met On Campus to the home screen. */
export function InstallCard() {
  const { canPrompt, installed, ios, prompt } = useInstall()
  const [asked, setAsked] = useState<string | null>(null)
  if (installed) return (
    <section className="card space-y-1" aria-labelledby="install-heading">
      <h2 id="install-heading" className="text-[17px] font-semibold">Installed</h2>
      <p className="text-sm text-ink-2">Met On Campus is on this device&apos;s home screen.</p>
    </section>
  )
  return (
    <section className="card space-y-2" aria-labelledby="install-heading">
      <h2 id="install-heading" className="text-[17px] font-semibold">Add to your home screen</h2>
      <p className="text-sm text-ink-2">Open Met On Campus like any other app: full screen, one tap, and it can notify you when something is waiting.</p>
      {canPrompt && <button type="button" className="btn" onClick={async () => setAsked(await prompt())}>Install the app</button>}
      {!canPrompt && ios && SHARE_STEPS}
      {!canPrompt && !ios && <p className="text-sm text-ink-2">In your browser&apos;s menu, choose <b>Install app</b> or <b>Add to Home screen</b>.</p>}
      {asked === 'dismissed' && <p className="text-xs text-ink-2">No problem. You can install it any time from here.</p>}
    </section>
  )
}

const KEY = 'moc.installBannerDismissedAt'
const hidden = () => { try { const t = Number(localStorage.getItem(KEY)); return !!t && Date.now() - t < 30 * 86_400_000 } catch { return false } }

/** A small, dismissible nudge at the top of the app. Only where installing is possible, and never once installed. */
export function InstallBanner() {
  const { canPrompt, installed, ios, prompt } = useInstall()
  const [gone, setGone] = useState(hidden)
  const [showSteps, setShowSteps] = useState(false)
  if (installed || gone || !(canPrompt || ios)) return null
  const dismiss = () => { setGone(true); setTimeout(() => document.getElementById('main')?.focus({ preventScroll: true }), 0); try { localStorage.setItem(KEY, String(Date.now())) } catch { /* shown again next visit */ } }
  return (
    <div role="region" aria-label="Install the app" className="mb-4 space-y-2 rounded-[12px] border border-line bg-subtle p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span><b>Get the app.</b> Open it from your home screen and get notified.</span>
        <div className="flex shrink-0 gap-2">
          {canPrompt
            ? <button type="button" className="btn h-9 px-3 text-sm" onClick={async () => { if ((await prompt()) === 'accepted') dismiss() }}>Install</button>
            : <button type="button" className="btn h-9 px-3 text-sm" aria-expanded={showSteps} onClick={() => setShowSteps(!showSteps)}>How</button>}
          <button type="button" className="btn btn-ghost h-9 px-3 text-sm" onClick={dismiss}>Not now</button>
        </div>
      </div>
      {!canPrompt && showSteps && SHARE_STEPS}
    </div>
  )
}
