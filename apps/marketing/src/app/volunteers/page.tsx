import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { VolunteerForm } from '~/components/VolunteerForm'
import { roles } from '~/lib/volunteers'

export const metadata: Metadata = {
  title: 'Volunteer',
  description: 'Help build Met On Campus. We are looking for volunteers at FUTMinna: a graphic designer, a video content creator and a campus ambassador.',
  alternates: { canonical: '/volunteers' },
}

const list = 'space-y-2 text-ink-2 [&_li]:flex [&_li]:gap-3 [&_li]:before:mt-2.5 [&_li]:before:size-1.5 [&_li]:before:shrink-0 [&_li]:before:rounded-full [&_li]:before:bg-ink-3 [&_li]:before:content-[""]'

export default function Volunteers() {
  return (
    <>
      <section className="container-x py-14 md:py-20">
        <div className="max-w-3xl">
          <h1 className="text-[clamp(2.4rem,5.5vw,4rem)] tracking-[-0.03em]">Volunteer with us.</h1>
          <p className="mt-5 max-w-[56ch] text-lg text-ink-2 sm:text-xl">Met On Campus is built by students, for students. We are looking for a few people to help us look good, sound good and be seen on campus.</p>
        </div>

        <div className="mt-10 max-w-3xl rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <p className="font-display text-lg">Before you apply</p>
          <ul className={`mt-3 ${list}`}>
            <li><span><strong className="font-semibold text-ink">Open to current FUTMinna students only</strong> for now.</span></li>
            <li><span><strong className="font-semibold text-ink">These are volunteer roles.</strong> There is no guarantee of payment or any financial compensation.</span></li>
          </ul>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {roles.map((r) => (
            <article key={r.id} className="flex flex-col rounded-2xl border border-line p-6">
              <h2 className="text-2xl">{r.title}</h2>
              <p className="mt-2 text-ink-2">{r.tagline}</p>
              <h3 className="mt-6 font-display text-base">What you would do</h3>
              <ul className={`mt-2 ${list}`}>{r.doing.map((d) => <li key={d}><span>{d}</span></li>)}</ul>
              <h3 className="mt-6 font-display text-base">What we are looking for</h3>
              <ul className={`mt-2 ${list}`}>{r.looking.map((d) => <li key={d}><span>{d}</span></li>)}</ul>
              <Link href={`/volunteers?role=${r.id}#apply`} className="btn-quiet mt-8 self-start">Apply for this role</Link>
            </article>
          ))}
        </div>
      </section>

      <section id="apply" className="container-x scroll-mt-24 pb-6">
        <div className="max-w-2xl">
          <h2 className="text-[clamp(1.8rem,4vw,2.6rem)] tracking-[-0.02em]">Apply</h2>
          <p className="mt-3 text-ink-2">Tell us a little about yourself. It takes a few minutes.</p>
          <div className="mt-8"><Suspense><VolunteerForm /></Suspense></div>
        </div>
      </section>
    </>
  )
}
