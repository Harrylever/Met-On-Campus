import { env } from "./env"

// Resend over plain fetch (no SDK). Without RESEND_API_KEY, dev prints the code to the console;
// production refuses to start without a key (see assertEmailConfigured).
export function assertEmailConfigured() {
  if (env.isProd && !env.resendApiKey)
    throw new Error("RESEND_API_KEY is required in production")
}

// Dev/test only: codes that would have been emailed, newest last. Never populated when a Resend key is set.
export const devOutbox: { to: string; code: string }[] = []

export async function sendVerificationCode(to: string, code: string) {
  if (!env.resendApiKey) {
    console.log(`[email:dev] verification code for ${to}: ${code}`)
    devOutbox.push({ to, code })
    if (devOutbox.length > 100) devOutbox.shift()
    return
  }
  const res = await fetch(env.resendApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.emailFrom,
      to: [to],
      subject: `${code} is your Met On Campus code`,
      text: `Your Met On Campus verification code is ${code}.\n\nIt expires in 10 minutes. If you did not request it, ignore this email.`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:420px"><p>Your Met On Campus verification code:</p><p style="font-size:32px;letter-spacing:.3em;font-weight:700;font-family:monospace">${code}</p><p style="color:#57534E">It expires in 10 minutes. If you did not request it, ignore this email.</p></div>`,
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok)
    throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
}
