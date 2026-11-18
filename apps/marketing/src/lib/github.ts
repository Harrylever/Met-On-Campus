import { site } from './site'

/**
 * The repository's star count, read from GitHub on the server when the page is built (and again at most once a day), never in
 * the visitor's browser. That keeps the site's promise of no third-party scripts, cookies or requests: a visitor only talks to
 * GitHub if they click the link. Returns null if GitHub cannot be reached, and the page simply leaves the number out.
 */
export async function starCount(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${site.repo.owner}/${site.repo.name}`, {
      headers: { Accept: 'application/vnd.github+json' },
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const n = (await res.json()).stargazers_count
    return typeof n === 'number' ? n : null
  } catch { return null }
}
