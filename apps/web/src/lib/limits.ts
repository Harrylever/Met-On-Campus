type ServerError = { value?: { error?: string; retryAfter?: number } }

/** "20 seconds", "5 minutes", "about 2 hours". */
const waitText = (seconds: number) =>
  seconds < 90 ? `${Math.max(1, Math.round(seconds))} second${Math.round(seconds) === 1 ? '' : 's'}` : seconds < 5400 ? `${Math.round(seconds / 60)} minutes` : `about ${Math.round(seconds / 3600)} hours`

/** What to show when the server says "too many requests" for `what` ("invites", "messages", "rooms"), or null for any other error. */
export function rateLimitedText(e: unknown, what: string): string | null {
  const v = (e as ServerError | null)?.value
  return v?.error === 'too_many_requests' ? `You have reached the limit for ${what} for now. Try again in ${waitText(v.retryAfter ?? 60)}.` : null
}
