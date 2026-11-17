import type { Metadata } from 'next'
import { PrintButton } from '~/components/PrintButton'
import { site } from '~/lib/site'

export const metadata: Metadata = {
  title: 'Scan to join',
  description: 'Scan the code with your phone camera to open Met On Campus and sign in with your university email.',
  alternates: { canonical: '/join' },
  robots: { index: false }, // a utility page for showing people, not a landing page
}

const host = site.appUrl.replace(/^https?:\/\//, '')
const steps = [
  'Scan the code with your phone camera.',
  'Enter your university email (it ends in .edu.ng).',
  'Type the 6-digit code we send you.',
]

// DOM order is title, code, steps: on a phone the code is on screen straight away (the page is mostly used by
// showing it to someone). From lg up the code moves to the right and spans both rows. Print keeps the same order.
export default function Join() {
  return (
    <section className="container-x grid gap-x-20 gap-y-8 py-10 md:py-16 lg:grid-cols-[1fr_auto] lg:grid-rows-[auto_1fr] print:block print:py-0 print:text-center">
      <div className="max-w-xl lg:col-start-1 lg:row-start-1 print:mx-auto print:max-w-none">
        <h1 className="text-[clamp(2.4rem,6vw,4.25rem)] tracking-[-0.03em]">Scan to join Met On Campus.</h1>
        <p className="mt-5 text-lg text-ink-2 sm:text-xl">Point your phone&apos;s camera at the code. It opens the app in your browser, so there is nothing to download.</p>
      </div>

      {/* Fixed white card, dark code: stays scannable in dark mode and on a projector. The SVG carries its own white
          quiet zone, so the card adds almost no padding and more of the width goes to the code. */}
      <div className="justify-self-center rounded-[1.75rem] bg-white p-1.5 shadow-sm ring-1 ring-line sm:p-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center print:my-6 print:inline-block print:shadow-none print:ring-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/join/qr.svg" alt={`QR code that opens ${host}`} width={480} height={480} className="size-[min(86vw,480px)] rounded-[1.4rem] print:size-[480px]" />
      </div>

      <div className="max-w-xl lg:col-start-1 lg:row-start-2 print:mx-auto print:max-w-none">
        <ol className="space-y-3 print:inline-block print:text-left">
          {steps.map((s, i) => (
            <li key={s} className="flex items-start gap-4">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-ink font-display text-base font-bold text-canvas print:bg-black print:text-white" aria-hidden="true">{i + 1}</span>
              <span className="pt-0.5 text-lg">{s}</span>
            </li>
          ))}
        </ol>

        <p className="mt-8 text-ink-2">No camera? Type this address instead:</p>
        <p className="mt-1 break-all font-display text-3xl font-bold tracking-tight sm:text-4xl">{host}</p>

        <div className="mt-8 flex flex-wrap gap-3 print:hidden">
          <a href={site.appUrl} className="btn">Open the app</a>
          <a href="/join/qr.png" download="met-on-campus-qr.png" className="btn-quiet">Download PNG</a>
          <a href="/join/qr.svg" download="met-on-campus-qr.svg" className="btn-quiet">Download SVG</a>
          <PrintButton className="btn-quiet" />
        </div>
        <p className="mt-4 max-w-[52ch] text-sm text-ink-3 print:hidden">The PNG is good for sharing in a chat. The SVG stays sharp at any size, which is best for posters and banners.</p>
      </div>
    </section>
  )
}
