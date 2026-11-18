'use client'
import { useEffect, useState } from 'react'
import { PHOTOS, photoSrc, withUtm } from '~/lib/photos'

type Mode = 'study' | 'friends' | 'romance'
const MODES: { id: Mode; label: string }[] = [{ id: 'study', label: 'Study' }, { id: 'friends', label: 'Friends' }, { id: 'romance', label: 'Romance' }]

// Illustrative profiles (not real students). Copy mirrors what the app actually shows for each mode.
const PROFILES: Record<Mode, { name: string; line: string; live: boolean; where: string; label: string; prompt: string; tags: string[]; common: string; cta: string }> = {
  study: { name: 'Amina', line: '400L Cyber Security', live: true, where: 'University Library, Reading Room 2', label: 'Studying this week', prompt: 'Looking for a partner to go through network security past questions.', tags: ['CSS 411', 'CSS 423'], common: '2 courses in common', cta: 'Invite to Study' },
  friends: { name: 'Ibrahim', line: '400L Electrical Engineering', live: true, where: 'School Field', label: 'Up for', prompt: 'Football at the school field on Saturdays. We need a goalkeeper.', tags: ['Football', 'Chess club'], common: 'You both follow Chess Club', cta: 'Say Hi' },
  romance: { name: 'Zainab', line: '400L Information Technology', live: false, where: 'Usually around the faculty in the evening', label: 'Looking for', prompt: 'Someone to gist with after evening lectures.', tags: ['Afrobeats', 'Poetry'], common: 'You both listed Poetry', cta: 'Send Spark' },
}

export function HeroDemo() {
  const [mode, setMode] = useState<Mode>('study')
  const i = MODES.findIndex((m) => m.id === mode)
  const p = PROFILES[mode]
  const photo = PHOTOS[mode]
  // Warm the other modes' photos so switching does not show an empty frame.
  useEffect(() => { (Object.keys(PHOTOS) as Mode[]).forEach((m) => { new Image().src = photoSrc(PHOTOS[m], 800) }) }, [])
  return (
    <div data-intent={mode} className="rounded-[2rem] bg-(--i-bg) p-5 transition-colors duration-500 sm:p-8">
      <div role="group" aria-label="Choose a mode to preview" className="relative grid grid-cols-3 rounded-full bg-surface/70 p-1">
        <span aria-hidden data-intent={mode} className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-surface shadow-sm ring-1 ring-(--i-line) transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{ width: 'calc((100% - 0.5rem) / 3)', transform: `translateX(${i * 100}%)` }} />
        {MODES.map((m) => (
          <button key={m.id} data-intent={m.id} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}
            className="relative z-10 flex h-11 items-center justify-center gap-2 rounded-full text-sm font-semibold text-ink-2 transition-colors aria-pressed:text-ink">
            <i className="size-2 rounded-full bg-(--i)" />{m.label}
          </button>
        ))}
      </div>

      <article key={mode} className="rise mt-4 overflow-hidden rounded-2xl bg-surface" aria-live="polite">
        <div className="relative aspect-[16/10] overflow-hidden bg-(--i-bg)">
          {/* A scene photo for the mode (not a portrait of the example student), hotlinked from Unsplash with credit. */}
          <img src={photoSrc(photo, 800)} srcSet={`${photoSrc(photo, 480)} 480w, ${photoSrc(photo, 800)} 800w, ${photoSrc(photo, 1200)} 1200w`}
            sizes="(min-width: 1024px) 440px, 90vw" alt={photo.alt} width={800} height={500} decoding="async" className="size-full object-cover" />
          {p.live && <span className="absolute right-3 top-3 inline-flex h-7 items-center gap-1.5 rounded-full bg-surface px-3 text-xs font-medium text-ink ring-1 ring-line"><i className="live-dot size-2 rounded-full bg-[#16A34A]" />Online now</span>}
        </div>
        <div className="space-y-3 p-5">
          <div>
            <p className="font-display text-xl font-semibold tracking-tight">{p.name} <span className="font-medium text-ink-2">{p.line}</span></p>
            <p className="text-sm text-ink-2">{p.where}</p>
          </div>
          <div className="rounded-xl bg-(--i-bg) p-3 ring-1 ring-(--i-line)">
            <p className="text-sm font-semibold text-(--i-ink)">{p.label}</p>
            <p className="text-[15px] leading-snug">{p.prompt}</p>
          </div>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {p.tags.map((t) => <span key={t} className="rounded-md bg-(--i-bg) px-2 py-0.5 text-(--i-ink) ring-1 ring-(--i-line)">{t}</span>)}
            <span className="text-(--i-ink)">{p.common}</span>
          </p>
          <span className="flex h-12 items-center justify-center rounded-full bg-(--i-ink) text-base font-semibold text-(--on-accent)" aria-hidden="true">{p.cta}</span>
        </div>
      </article>
      {/* Unsplash credit sits directly under the photo it belongs to, and follows it when the mode changes. */}
      <p className="mt-3 text-center text-sm text-ink-2">Tap a mode to see how it changes.</p>
      <p className="mt-1.5 text-center text-[11px] leading-snug text-ink-3">
        Photo by{' '}
        <a href={withUtm(photo.authorUrl)} target="_blank" rel="noopener noreferrer" className="underline decoration-1 underline-offset-2 hover:text-ink-2">{photo.author}</a>{' '}on{' '}
        <a href={withUtm('https://unsplash.com')} target="_blank" rel="noopener noreferrer" className="underline decoration-1 underline-offset-2 hover:text-ink-2">Unsplash</a>
      </p>
    </div>
  )
}
