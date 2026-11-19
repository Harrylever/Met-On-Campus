// One line per request, so the deploy logs show which routes are being called. Deliberately small:
//  - the matched route PATTERN (/unsubscribe/:token), never the real URL, so tokens, ids and query strings stay out of the logs;
//  - no headers, cookies, bodies, IPs or names;
//  - the health check is skipped (the platform pings it constantly).
let sink: ((line: string) => void) | null = process.env.NODE_ENV === 'test' ? null : console.log
/** Where lines go. Off in tests unless a test sets its own; `null` turns it off. */
export const setHttpLogSink = (fn: ((line: string) => void) | null) => { sink = fn }

export const formatHttpLine = (method: string, route: string, status: number, ms: number) => `[http] ${method} ${route} ${status} ${Math.round(ms)}ms`

const started = new WeakMap<Request, number>()
export const markStart = (request: Request) => { if (sink) started.set(request, performance.now()) }

export function logRequest(request: Request, route: string | undefined, status: unknown) {
  if (!sink) return
  const clean = route && route.length > 1 ? route.replace(/\/+$/, '') : route // grouped routes report "/me/"
  const pattern = clean && clean !== '/*' ? clean : 'unmatched' // a path that matched nothing is junk or a scanner: never echo it
  if (pattern === '/health') return
  const t = started.get(request)
  started.delete(request)
  const code = Number(status)
  sink(formatHttpLine(request.method, pattern, Number.isFinite(code) ? code : 200, t === undefined ? 0 : performance.now() - t))
}
