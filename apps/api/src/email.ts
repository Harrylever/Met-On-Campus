import { env } from "./env"

// Resend over plain fetch (no SDK). Without RESEND_API_KEY, dev prints the code to the console;
// production refuses to start without a key (see assertEmailConfigured).
export function assertEmailConfigured() {
  if (env.isProd && !env.resendApiKey)
    throw new Error("RESEND_API_KEY is required in production")
}

// Dev/test only: codes that would have been emailed, newest last. Never populated when a Resend key is set.
export const devOutbox: { to: string; code: string }[] = []

type Copy = { subject: (code: string) => string; text: (code: string) => string; html: (code: string) => string }

const SIGN_IN: Copy = {
  subject: (c) => `${c} is your Met On Campus code`,
  text: (c) => `Your Met On Campus verification code is ${c}.\n\nIt expires in 10 minutes. If you did not request it, ignore this email.`,
  html: (c) => `<div style="font-family:system-ui,sans-serif;max-width:420px"><p>Your Met On Campus verification code:</p><p style="font-size:32px;letter-spacing:.3em;font-weight:700;font-family:monospace">${c}</p><p style="color:#57534E">It expires in 10 minutes. If you did not request it, ignore this email.</p></div>`,
}
const DELETE_ACCOUNT: Copy = {
  subject: (c) => `${c} is your code to delete your Met On Campus account`,
  text: (c) => `Someone asked to permanently delete your Met On Campus account. To confirm it was you, enter this code: ${c}\n\nIt expires in 10 minutes. Deleting removes your profile, photos and messages and cannot be undone.\n\nIf this was not you, do not share the code. Ignore this email and your account stays as it is.`,
  html: (c) => `<div style="font-family:system-ui,sans-serif;max-width:420px"><p>Someone asked to <b>permanently delete</b> your Met On Campus account. To confirm it was you, enter this code:</p><p style="font-size:32px;letter-spacing:.3em;font-weight:700;font-family:monospace">${c}</p><p style="color:#57534E">It expires in 10 minutes. Deleting removes your profile, photos and messages and cannot be undone.</p><p style="color:#57534E">If this was not you, do not share the code. Ignore this email and your account stays as it is.</p></div>`,
}

async function sendCode(to: string, code: string, copy: Copy) {
  if (!env.resendApiKey) {
    console.log(`[email:dev] verification code for ${to}: ${code}`)
    devOutbox.push({ to, code })
    if (devOutbox.length > 100) devOutbox.shift()
    return
  }
  const res = await fetch(env.resendApiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.emailFrom, to: [to], subject: copy.subject(code), text: copy.text(code), html: copy.html(code) }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

export const sendVerificationCode = (to: string, code: string) => sendCode(to, code, SIGN_IN)
export const sendDeletionCode = (to: string, code: string) => sendCode(to, code, DELETE_ACCOUNT)
