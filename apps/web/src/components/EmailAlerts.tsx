import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, unwrap } from '~/lib/api'

/** One switch for "something is waiting" emails. Sign-in codes are always sent; this only controls the alerts. */
export function EmailAlerts({ on, onChanged }: { on: boolean; onChanged: () => void }) {
  const [value, setValue] = useState(on)
  const save = useMutation({
    mutationFn: (next: boolean) => unwrap(api.me.patch({ emailAlerts: next })),
    onSuccess: onChanged,
    onError: () => setValue((v) => !v), // put the switch back if it did not save
  })
  return (
    <section className="card space-y-2" aria-labelledby="alerts-heading">
      <label className="flex items-center justify-between gap-4">
        <span id="alerts-heading" className="text-[17px] font-semibold">Email me when something is waiting</span>
        <input type="checkbox" role="switch" className="size-6 shrink-0" checked={value} disabled={save.isPending}
          onChange={(e) => { setValue(e.target.checked); save.mutate(e.target.checked) }} />
      </label>
      <p className="text-sm text-ink-2">If an invite, a message or a room update has been waiting a while and you are not in the app, we send one short email, at most once every 6 hours. It never names anyone or any mode, so it stays private if someone sees your inbox.</p>
      {save.isError && <p role="alert" className="text-sm text-danger">Could not save. Try again.</p>}
    </section>
  )
}
