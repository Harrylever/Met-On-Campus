import { starCount } from '~/lib/github'
import { site } from '~/lib/site'

// "Star on GitHub" as a plain link. GitHub's own button would load a script from GitHub on every visit, which this site promises
// not to do. The count is read once on the server (see lib/github.ts) and only shown from 10 up: "1" would not help anyone.
const SHOW_COUNT_FROM = 10

export async function StarOnGithub({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const stars = await starCount()
  const colours = tone === 'dark' ? 'border-canvas/40 text-canvas hover:border-canvas' : 'border-ink/25 text-ink hover:border-ink'
  return (
    <a href={site.repo.url} target="_blank" rel="noopener noreferrer"
       className={`inline-flex h-11 items-center gap-2 rounded-full border px-5 text-[15px] font-semibold transition ${colours}`}>
      <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
      </svg>
      <span>Star on GitHub<span className="sr-only"> (opens in a new tab)</span></span>
      {stars !== null && stars >= SHOW_COUNT_FROM && <span className="border-l border-current/30 pl-2 font-mono text-[13px] opacity-80">{stars}<span className="sr-only"> stars</span></span>}
    </a>
  )
}
