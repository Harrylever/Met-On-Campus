import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrap, type Intent } from '~/lib/api'
import { photoUrl } from '~/components/Avatar'

const MESSAGES: Record<string, string> = {
  invalid_image: 'That file could not be used. Choose a JPEG, PNG or WebP photo, at least 200 pixels wide.',
  too_large: 'That photo is over 6 MB. Choose a smaller one.',
  too_many_uploads: 'You have uploaded a few photos today. Try again tomorrow.',
  mode_not_enabled: 'Turn this mode on and save before adding a photo.',
  photos_unavailable: 'Photo uploads are not available right now.',
}

/** One photo per mode. It goes to our team first; until they approve it nobody else sees it. */
export function PhotoField({ mode, modeOn, name }: { mode: Intent; modeOn: boolean; name: string }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const list = useQuery({ queryKey: ['photos'], queryFn: () => unwrap(api.me.photos.get()) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['photos'] })

  const upload = useMutation({
    mutationFn: (file: File) => unwrap(api.me.photos.post({ intent: mode, file })),
    onSuccess: () => { setError(null); refresh() },
    onError: (e: { status?: number; value?: { error?: string } }) => setError(MESSAGES[e.value?.error ?? ''] ?? (e.status === 413 ? MESSAGES.too_large! : 'Could not upload. Try again.')),
  })
  const remove = useMutation({ mutationFn: (id: string) => unwrap(api.me.photos({ id }).delete()), onSuccess: refresh })

  if (list.data && !list.data.enabled) return null
  const p = list.data?.photos[mode]
  const shown = p?.pending ?? p?.approved
  const busy = upload.isPending || remove.isPending
  return (
    <div className="space-y-2" aria-live="polite">
      <span className="text-sm font-semibold">Photo</span>
      <div className="flex items-center gap-4">
        {shown
          ? <img src={photoUrl(shown.id)} alt={`Your ${mode} photo`} width={88} height={88} className="size-22 shrink-0 rounded-full border border-(--i-line) object-cover" />
          : <span aria-hidden="true" className="flex size-22 shrink-0 items-center justify-center rounded-full border border-dashed border-(--i-line) bg-(--i-bg) font-display text-3xl font-bold text-(--i-ink)">{name[0]}</span>}
        <div className="space-y-2">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setError(null); upload.mutate(f) } }} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost h-11 px-4" disabled={!modeOn || busy} onClick={() => input.current?.click()}>
              {upload.isPending ? 'Uploading…' : p?.approved || p?.pending ? 'Choose another' : 'Add a photo'}
            </button>
            {(p?.pending || p?.approved) && (
              <button type="button" className="btn btn-ghost h-11 px-4" disabled={busy} onClick={() => remove.mutate((p.pending ?? p.approved)!.id)}>
                {p?.pending ? 'Cancel upload' : 'Remove'}
              </button>
            )}
          </div>
        </div>
      </div>
      {!modeOn && <p className="text-xs text-ink-2">Turn this mode on and save to add a photo.</p>}
      {p?.pending && <p className="rounded-[10px] bg-subtle p-3 text-sm text-ink">{p.approved ? 'Your new photo is waiting for review. Your current photo stays up until it is approved.' : 'Your photo is waiting for review. Only you can see it until our team approves it.'}</p>}
      {p?.rejected && <p role="status" className="rounded-[10px] bg-romance-bg p-3 text-sm text-romance-ink">We could not approve your last photo.{p.rejected.note ? ` ${p.rejected.note}` : ''}</p>}
      {p?.approved && !p.pending && <p className="text-xs text-ink-2">{mode === 'romance' ? 'Shown only to people you match with.' : 'Shown on your profile card to other students in this mode.'}</p>}
      {!p?.approved && !p?.pending && !p?.rejected && <p className="text-xs text-ink-2">A clear photo of you. Our team checks every photo before anyone else sees it.{mode === 'romance' ? ' In Romance it is shown only after a match.' : ''}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  )
}
