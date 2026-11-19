import Link from 'next/link'
import { Brand } from './Brand'
import { site } from '~/lib/site'
import { StarOnGithub } from './StarOnGithub'

const col = 'space-y-2 text-[15px] text-ink-2 [&_a]:hover:text-ink'
export function Footer() {
  return (
    <footer className="mt-24 border-t border-line print:hidden">
      <div className="container-x grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="space-y-3">
          <Brand />
          <p className="max-w-xs text-[15px] text-ink-2">A network for verified university students. Meet people for studying, friendship and dating, in public places on campus.</p>
          <p className="max-w-xs text-[15px] text-ink-2">Open source, under the AGPL-3.0 licence.</p>
          <StarOnGithub />
        </div>
        <nav aria-label="Product"><h2 className="mb-3 font-display text-base">Product</h2>
          <ul className={col}><li><a href={site.appUrl}>Open the app</a></li><li><Link href="/join">Scan to join</Link></li><li><Link href="/#how-it-works">How it works</Link></li><li><Link href="/safety">Safety</Link></li><li><Link href="/universities">For universities</Link></li><li><Link href="/volunteers">Volunteer</Link></li></ul></nav>
        <nav aria-label="Legal"><h2 className="mb-3 font-display text-base">Legal</h2>
          <ul className={col}><li><Link href="/terms">Terms of service</Link></li><li><Link href="/privacy">Privacy policy</Link></li></ul></nav>
        <div><h2 className="mb-3 font-display text-base">Contact</h2>
          <p className="text-[15px] text-ink-2">{site.contactEmail ? <a className="underline underline-offset-4 hover:no-underline" href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a> : 'Contact details coming soon.'}</p></div>
      </div>
      <div className="border-t border-line"><p className="container-x py-5 text-sm text-ink-3">© {new Date().getFullYear()} Met On Campus</p></div>
    </footer>
  )
}
