import { useEffect, useRef, useState } from 'react'
import { Brand } from '~/components/ui'

/** A single placeholder bar/block. Decorative: the region around it announces "Loading". */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />
}

/** Wraps skeletons so assistive tech hears one "Loading …" instead of a pile of empty shapes. */
export function LoadingRegion({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return <div role="status" aria-busy="true" aria-live="polite" className={className}><span className="sr-only">{label}</span>{children}</div>
}

/**
 * True while something has been loading long enough to be worth showing a skeleton for.
 * Quick loads never flash one (`delayMs`), and once a skeleton appears it stays long enough to read as a state, not a
 * glitch (`minMs`). Only the first load counts: pass `isLoading`, which is false during background refetches.
 */
export function useSkeleton(loading: boolean, delayMs = 150, minMs = 350) {
  const [show, setShow] = useState(false)
  const shownAt = useRef(0)
  useEffect(() => {
    if (loading && !show) { const t = setTimeout(() => { shownAt.current = Date.now(); setShow(true) }, delayMs); return () => clearTimeout(t) }
    if (!loading && show) { const t = setTimeout(() => setShow(false), Math.max(0, minMs - (Date.now() - shownAt.current))); return () => clearTimeout(t) }
  }, [loading, show, delayMs, minMs])
  return show
}

// ---- Shapes that mirror the real screens, so nothing jumps when the data arrives -------------------------------------

export function StudentCardSkeleton() {
  return (
    <div className="card flex flex-col gap-3 overflow-hidden p-0">
      <Skeleton className="h-40 w-full !rounded-none" />
      <div className="flex flex-col gap-3 p-4 pt-1">
        <div className="space-y-2"><Skeleton className="h-5 w-3/5" /><Skeleton className="h-3.5 w-2/5" /></div>
        <Skeleton className="h-[76px] w-full !rounded-[10px]" />
        <div className="flex gap-2"><Skeleton className="h-6 w-16" /><Skeleton className="h-6 w-20" /></div>
        <div className="flex gap-2"><Skeleton className="h-12 flex-1 !rounded-[10px]" /><Skeleton className="h-12 w-20 !rounded-[10px]" /></div>
      </div>
    </div>
  )
}

export function RoomCardSkeleton() {
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center gap-2"><Skeleton className="h-6 w-16" /><Skeleton className="h-6 w-20 !rounded-full" /><Skeleton className="ml-auto h-4 w-20" /></div>
      <div className="space-y-2"><Skeleton className="h-5 w-4/5" /><Skeleton className="h-3.5 w-3/5" /></div>
      <Skeleton className="h-1.5 w-full !rounded-full" />
      <Skeleton className="h-3.5 w-2/5" />
      <Skeleton className="h-12 w-full !rounded-[10px]" />
    </div>
  )
}

const bubble = (side: 'l' | 'r', w: string) => <Skeleton key={`${side}${w}`} className={`h-10 ${w} !rounded-2xl ${side === 'r' ? 'self-end' : 'self-start'}`} />
export function ConversationChipsSkeleton() {
  return <div className="flex gap-2"><Skeleton className="h-11 w-24 !rounded-full" /><Skeleton className="h-11 w-20 !rounded-full" /><Skeleton className="h-11 w-28 !rounded-full" /></div>
}
export function BubblesSkeleton() {
  return <div className="flex flex-col gap-2">{[bubble('l', 'w-3/5'), bubble('r', 'w-1/2'), bubble('l', 'w-2/3'), bubble('r', 'w-2/5')]}</div>
}
export function ConversationSkeleton() {
  return (
    <section className="card flex flex-col gap-3">
      <Skeleton className="h-5 w-2/3" />
      <BubblesSkeleton />
      <div className="flex gap-2"><Skeleton className="h-12 flex-1 !rounded-[10px]" /><Skeleton className="h-12 w-16 !rounded-[10px]" /><Skeleton className="h-12 w-16 !rounded-[10px]" /></div>
    </section>
  )
}

export function ProfileFormSkeleton() {
  const field = (h: string) => <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className={`${h} w-full !rounded-[10px]`} /></div>
  return (
    <section className="card space-y-4">
      <div className="flex items-center justify-between"><Skeleton className="h-5 w-40" /><Skeleton className="h-6 w-11 !rounded-full" /></div>
      {field('h-12')}{field('h-24')}{field('h-12')}
      <div className="space-y-2"><Skeleton className="h-4 w-24" />
        <div className="flex flex-wrap gap-2">{['w-32', 'w-36', 'w-36', 'w-28', 'w-32', 'w-36', 'w-40', 'w-36'].map((w, i) => <Skeleton key={i} className={`h-11 ${w} !rounded-full`} />)}</div></div>
      {field('h-12')}
      <Skeleton className="h-12 w-full !rounded-[10px]" />
    </section>
  )
}

export function BlockedListSkeleton() {
  return <div className="space-y-3"><Skeleton className="h-4 w-2/3" /></div>
}

/** What shows while the signed-in shell itself is loading (first open, or a slow account check). */
export function ShellSkeleton() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col lg:max-w-6xl">
      <header className="flex flex-col gap-3 px-4 pt-5 lg:flex-row lg:items-center lg:justify-between">
        <Brand />
        <div className="flex gap-2"><Skeleton className="h-7 w-28 !rounded-full" /><Skeleton className="h-7 w-40 !rounded-full" /></div>
      </header>
      <LoadingRegion label="Loading" className="flex flex-1 flex-col gap-5 px-4 pb-24 pt-5">
        <Skeleton className="h-[52px] w-full !rounded-full" />
        <Skeleton className="h-44 w-full !rounded-[20px]" />
        <StudentCardSkeleton />
      </LoadingRegion>
      <nav aria-hidden="true" className="fixed inset-x-0 bottom-0 mx-auto flex h-16 max-w-md items-center justify-around border-t border-line bg-surface lg:max-w-6xl">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-3.5 w-14" />)}
      </nav>
    </div>
  )
}
