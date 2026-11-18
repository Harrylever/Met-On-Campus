import Link from 'next/link'
import { HeroDemo } from '~/components/HeroDemo'
import { Faq } from '~/components/Faq'
import { site } from '~/lib/site'

const steps = [
  { t: 'Verify your university email', d: 'We send a 6-digit code to your .edu.ng address. It proves you are a student, and it is never shown on your profile.' },
  { t: 'Choose what you are here for', d: 'Turn on Study, Friends, Romance, or any mix. Each one gets its own profile and its own inbox.' },
  { t: 'Meet on campus', d: 'Suggest a public spot like the library or the Student Union cafeteria, pick a time, and the other person accepts or says no.' },
]
const modes: { id: string; name: string; lead: string; points: string[] }[] = [
  { id: 'study', name: 'Study', lead: 'Find someone to read with.', points: ['Match on the courses you share', 'Join a study room at the library or a quiet spot on campus', 'Find people for a group assignment'] },
  { id: 'friends', name: 'Friends', lead: 'People who like what you like.', points: ['Clubs, football, food and movie nights', 'Say hi to someone with the same interests', 'Join a hangout at the school field or the cafeteria'] },
  { id: 'romance', name: 'Romance', lead: 'Private by default.', points: ['You only see people who also turned Romance on', 'Hide your profile from your own department', 'Meet one to one, in public places only'] },
]
const safety = [
  ['Everyone is a verified student.', 'Joining needs a code sent to a university email address.'],
  ['Meetups happen in public.', 'You can only suggest public campus spots, never a private address.'],
  ['Blocking works both ways.', 'You and the person you block disappear from each other: no search results, no rooms, no messages.'],
  ['Reports go to a real person.', 'Report a profile or a single message. Our team reviews it and can suspend accounts.'],
  ['Staff cannot read your chats.', 'For a report they see the one reported message. Every time staff look at a profile, it is logged.'],
  ['Romance needs both people.', 'You are only shown to students who also turned it on, and you can hide from your own department.'],
] as const
const faq = [
  { q: 'Who can join?', a: <>Students with a university email ending in .edu.ng. You only see students from your own university. We are starting at FUTMinna, so other campuses may be quiet at first.</> },
  { q: 'Do I need to download anything?', a: <>No app store needed. It runs in your phone&apos;s browser. <a href={site.appUrl}>Open the app</a> and sign in with your school email. You can also add it to your home screen so it opens like an app, and turn on notifications if you want them.</> },
  { q: 'What do the notifications say?', a: <>Only that something is waiting, like &quot;You have a new invite&quot;. They never include names, messages or which mode it is, so nothing private shows on a lock screen. You choose whether to turn them on, per device, in Profile.</> },
  { q: 'Can other students see my email?', a: <>No. Your email is only used to confirm you are a student and to send you sign-in codes.</> },
  { q: 'Will people in Friends see my Romance profile?', a: <>No. People only see the profile for the mode where they found you, and Romance is only shown to students who also turned it on. A Study chat never appears in Friends or Romance either.</> },
  { q: 'What does "Online now" mean?', a: <>While you have the app open, you show up as online. When you close it, you drop off by itself after about a minute and a half. We do not track where you are, so online does not mean on campus: check the spot with the person before you set off.</> },
  { q: 'Do I have to say yes to every invite?', a: <>No. When someone invites you, you choose Accept or Not now. Until you answer, they can send one message. If you choose Not now, the conversation closes and they cannot message you again.</> },
  { q: 'Can I delete my account?', a: <>Yes, any time, in the app: Profile, then Delete your account. We email a code to your university address to make sure it is you. Your profiles, photos and chats are removed straight away and it cannot be undone. Reports and safety records are kept without a link to you. <Link href="/privacy">Read the details</Link>.</> },
  { q: 'Can I add a profile photo?', a: <>Yes, one for each mode, and it is optional. Our team checks every photo before anyone else sees it, and you will see why if one is not approved. In Romance, your photo is only shown to someone once you have both said yes.</> },
  { q: 'Someone is bothering me. What can I do?', a: <>Open their profile or your chat, choose Block or report, and pick an option. Blocking takes effect straight away. <Link href="/safety">Read how safety works</Link>.</> },
]

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="container-x grid items-center gap-12 pb-16 pt-12 md:pb-24 md:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div>
          <h1 className="text-[clamp(2.9rem,7.2vw,5.4rem)] tracking-[-0.035em]">Find your people on campus.</h1>
          <p className="mt-6 max-w-[48ch] text-lg text-ink-2 sm:text-xl">Met On Campus is for university students who want a study partner, a football team for Saturday, or someone to gist with after lectures. Verify with your school email, choose what you are here for, and meet in public places on campus.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={site.appUrl} className="btn">Open the app</a>
            <a href="#how-it-works" className="btn-quiet">See how it works</a>
          </div>
          <p className="mt-5 max-w-[48ch] text-[15px] text-ink-3">Only students with a university email can join. We are starting at FUTMinna, and every faculty and department is welcome.</p>
        </div>
        <HeroDemo />
      </section>

      {/* How it works: a real sequence, so numbered */}
      <section id="how-it-works" className="container-x py-16 md:py-24">
        <h2 className="max-w-[18ch] text-[clamp(2rem,4.4vw,3.25rem)]">Three steps from sign-up to meeting.</h2>
        <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
          {steps.map((s, i) => (
            <li key={s.t} className="border-t border-ink pt-5">
              <span className="font-display text-5xl font-bold text-ink-3" aria-hidden="true">{i + 1}</span>
              <h3 className="mt-3 text-xl">{s.t}</h3>
              <p className="mt-2 text-ink-2">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Modes: unboxed columns, mode colour as the top rule */}
      <section className="container-x py-16 md:py-24">
        <h2 className="max-w-[22ch] text-[clamp(2rem,4.4vw,3.25rem)]">Three ways to meet people, kept apart.</h2>
        <p className="mt-4 max-w-[58ch] text-lg text-ink-2">Turn on one, two or all three. Each mode has its own profile and its own inbox, and they never mix.</p>
        <div className="mt-12 grid gap-12 md:grid-cols-3 md:gap-8">
          {modes.map((m) => (
            <div key={m.id} data-intent={m.id} className="border-t-[6px] border-(--i) pt-5">
              <h3 className="flex items-center gap-2.5 text-2xl text-(--i-ink)"><i className="size-2.5 rounded-full bg-(--i)" />{m.name}</h3>
              <p className="mt-2 font-display text-xl font-semibold leading-snug">{m.lead}</p>
              <ul className="mt-4 space-y-2.5 text-ink-2">
                {m.points.map((pt) => <li key={pt} className="flex gap-3"><span className="mt-[0.72em] size-1.5 shrink-0 rounded-full bg-(--i)" aria-hidden="true" /><span>{pt}</span></li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Online now + rooms */}
      <section className="container-x grid items-center gap-12 py-16 md:py-24 lg:grid-cols-2 lg:gap-20">
        <div>
          <h2 className="max-w-[16ch] text-[clamp(2rem,4.4vw,3.25rem)]">See who is around right now.</h2>
          <p className="mt-5 max-w-[52ch] text-lg text-ink-2">Students with the app open show up as Online now, and drop off on their own when they leave. Join a study room or a hangout at a public campus spot; the host approves who comes.</p>
          <p className="mt-4 max-w-[52ch] text-ink-2">Rooms are for Study and Friends only. Romance meetups are arranged one to one in Messages.</p>
        </div>
        <div>
          <ul className="divide-y divide-line border-y border-line">
            {[
              { id: 'study', tag: 'MTH 201', title: 'Engineering Maths Past Questions', place: 'University Library', time: 'Until 5:30 PM', seats: '3 of 5 spots taken', live: true },
              { id: 'friends', tag: 'Football', title: 'Saturday Football Match', place: 'School Field', time: 'Until 6:00 PM', seats: '7 of 10 spots taken', live: true },
              { id: 'study', tag: 'BCH 301', title: 'Enzymes Revision Group', place: 'University Library, Reading Room 1', time: 'Today, 4:00 PM', seats: '2 of 4 spots taken', live: false },
            ].map((r) => (
              <li key={r.title} data-intent={r.id} className="flex items-start justify-between gap-4 py-4">
                <div>
                  <p className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded-md bg-(--i-bg) px-2 py-0.5 font-medium text-(--i-ink) ring-1 ring-(--i-line)">{r.tag}</span>{r.live && <span className="inline-flex items-center gap-1.5 text-ink-2"><i className="live-dot size-2 rounded-full bg-[#16A34A]" />Live now</span>}</p>
                  <p className="mt-1.5 font-display text-lg font-semibold">{r.title}</p>
                  <p className="text-sm text-ink-2">{r.place}, {r.time}</p>
                </div>
                <p className="shrink-0 pt-1 text-sm text-ink-2">{r.seats}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-3">Example rooms, not real ones.</p>
        </div>
      </section>

      {/* Safety */}
      <section className="bg-subtle py-16 md:py-24">
        <div className="container-x">
          <h2 className="max-w-[20ch] text-[clamp(2rem,4.4vw,3.25rem)]">Built so saying no is easy.</h2>
          <dl className="mt-12 grid gap-x-12 gap-y-8 md:grid-cols-2">
            {safety.map(([t, d]) => (<div key={t}><dt className="font-display text-xl font-semibold">{t}</dt><dd className="mt-1 max-w-[52ch] text-ink-2">{d}</dd></div>))}
          </dl>
          <Link href="/safety" className="btn-quiet mt-12">Read how safety works</Link>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="container-x py-16 md:py-24">
        <h2 className="text-[clamp(2rem,4.4vw,3.25rem)]">Questions students ask.</h2>
        <div className="mt-10 max-w-3xl"><Faq items={faq} /></div>
      </section>

      {/* Close */}
      <section className="container-x pb-8 pt-8 md:pt-16">
        <div className="rounded-[2rem] bg-ink px-6 py-14 text-canvas sm:px-12 md:py-20">
          <h2 className="max-w-[16ch] text-[clamp(2.25rem,5.5vw,4rem)]">Come meet your campus.</h2>
          <p className="mt-4 max-w-[46ch] text-lg opacity-80">It takes a school email and about a minute.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={site.appUrl} className="inline-flex h-12 items-center rounded-full bg-canvas px-6 text-base font-semibold text-ink transition hover:opacity-90">Open the app</a>
            {/* Outline style on the dark banner: clearly secondary, still 48px tall and high contrast. */}
            <Link href="/join" className="inline-flex h-12 items-center gap-2.5 rounded-full border border-canvas/40 px-6 text-base font-semibold text-canvas transition hover:border-canvas">
              {/* QR-scan glyph: corner brackets around small squares. Decorative; the label carries the meaning. */}
              <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
                <rect x="8.5" y="8.5" width="2.5" height="2.5" rx="0.4" /><rect x="13" y="8.5" width="2.5" height="2.5" rx="0.4" /><rect x="8.5" y="13" width="2.5" height="2.5" rx="0.4" /><path d="M13.2 14.2h2.3" />
              </svg>
              Scan to join
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
