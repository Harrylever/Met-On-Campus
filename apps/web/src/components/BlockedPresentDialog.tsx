import { useEffect, useRef } from 'react'

/**
 * Asked before you join a call that someone you blocked is already in. A native modal dialog, so focus stays inside it and
 * Escape means "Not now". Joining anyway is your choice; nothing about it is shared with them.
 */
export function BlockedPresentDialog({ people, busy = false, onJoin, onCancel }: { people: { name: string }[]; busy?: boolean; onJoin: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    return () => { if (d?.open) d.close() }
  }, [])
  const names = people.map((p) => p.name)
  const who = names.length === 0 ? 'Someone you blocked is' : names.length === 1 ? `${names[0]}, whom you blocked, is` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}, whom you blocked, are`
  return (
    <dialog ref={ref} aria-labelledby="blocked-present-title" aria-describedby="blocked-present-body"
      onCancel={(e) => { e.preventDefault(); onCancel() }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-[16px] border border-line bg-surface p-5 text-ink backdrop:bg-ink/40">
      <h2 id="blocked-present-title" className="text-[17px] font-semibold">Someone you blocked is in this call</h2>
      <p id="blocked-present-body" className="mt-2 text-sm text-ink-2">{who} in the call right now. They would hear you and you would hear them. You can join anyway, or come back later.</p>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn btn-i flex-1" disabled={busy} onClick={onJoin}>{busy ? 'Joining…' : 'Join anyway'}</button>
        <button type="button" autoFocus className="btn btn-ghost flex-1" onClick={onCancel}>Not now</button>
      </div>
    </dialog>
  )
}
