import { env } from "./env"
import { renderEmail, type EmailName } from "./mail/render"

// Resend over plain fetch (no SDK). Without RESEND_API_KEY, dev prints the code to the console;
// production refuses to start without a key (see assertEmailConfigured).
export function assertEmailConfigured() {
  if (env.isProd && !env.resendApiKey)
    throw new Error("RESEND_API_KEY is required in production")
}

// Dev/test only, never populated when a Resend key is set. `devOutbox` holds sign-in and deletion codes (newest last);
// `devMail` holds every email in full so tests and the preview can read it.
export const devOutbox: { to: string; code: string }[] = []
export const devMail: { to: string; subject: string; html: string; text: string; headers: Record<string, string> }[] = []
const keep = <T>(list: T[], item: T) => { list.push(item); if (list.length > 100) list.shift() }

async function deliver(to: string, name: EmailName, data: Record<string, unknown>, headers: Record<string, string> = {}) {
  const { subject, html, text } = renderEmail(name, data)
  if (!env.resendApiKey) {
    keep(devMail, { to, subject, html, text, headers })
    if (typeof data.code === "string") {
      console.log(`[email:dev] verification code for ${to}: ${data.code}`)
      keep(devOutbox, { to, code: data.code })
    } else console.log(`[email:dev] "${subject}" to ${to}`)
    return
  }
  const res = await fetch(env.resendApiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.emailFrom, to: [to], subject, html, text, ...(Object.keys(headers).length ? { headers } : {}) }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

export const sendVerificationCode = (to: string, code: string) => deliver(to, "signin", { code })
export const sendDeletionCode = (to: string, code: string) => deliver(to, "delete-account", { code })

/**
 * "Something is waiting" alert. Deliberately generic: counts by kind, no names, no mode, so it is safe if someone sees
 * the inbox. Carries a one-click unsubscribe (RFC 8058), which mail providers want for anything that is not a code.
 */
export type Waiting = { invites: number; chats: number; rooms: number }
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
export function waitingLines(w: Waiting) {
  return [
    ...(w.invites ? [plural(w.invites, "new invite", "new invites")] : []),
    ...(w.chats ? [plural(w.chats, "unread chat", "unread chats")] : []),
    ...(w.rooms ? [plural(w.rooms, "room update", "room updates")] : []),
  ]
}
export function sendWaitingAlert(to: string, w: Waiting, unsubscribeToken: string) {
  const total = w.invites + w.chats + w.rooms
  const unsubscribeUrl = `${env.publicApiUrl}/unsubscribe/${unsubscribeToken}`
  return deliver(to, "waiting", {
    subject: total === 1 ? "You have 1 thing waiting on Met On Campus" : `You have ${total} things waiting on Met On Campus`,
    summary: total === 1 ? "something is waiting" : "a few things are waiting",
    lines: waitingLines(w), appUrl: env.webOrigin, unsubscribeUrl,
  }, { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" })
}
