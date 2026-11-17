import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation } from "@tanstack/react-query"
import { api, unwrap } from "~/lib/api"
import { Brand } from "~/components/ui"

// After an expired session, the app sends people here with the page they were on, and brings them back to it.
const RETURN_TO = ["/discover", "/rooms", "/messages", "/profile"] as const
type ReturnTo = (typeof RETURN_TO)[number]

export const Route = createFileRoute("/login")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { redirect?: ReturnTo } => ({
    redirect: RETURN_TO.find((p) => p === s.redirect),
  }),
  component: Login,
})

type ApiError = { status?: number; value?: { error?: string; retryAfter?: number } }
const wait = (seconds: number) =>
  seconds <= 90
    ? `${seconds} second${seconds === 1 ? "" : "s"}`
    : `about ${Math.ceil(seconds / 60)} minutes`

function Login() {
  const nav = useNavigate()
  const { redirect } = Route.useSearch()
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"email" | "code">("email")
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const cleanEmail = email.trim()
  const okEmail = /^[^@\s]+@[^@\s]+\.edu\.ng$/i.test(cleanEmail)
  const looksPersonal = !okEmail && /@[^@\s]+\.[a-z]{2,}$/i.test(cleanEmail)

  // One tick a second while the "send a new code" countdown is running.
  useEffect(() => {
    if (resendAt <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [resendAt])
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000))

  const send = useMutation({
    mutationFn: () => unwrap(api.auth["request-code"].post({ email: cleanEmail })),
    onSuccess: () => {
      setStep("code")
      setCode("")
      setNow(Date.now())
      setResendAt(Date.now() + 60_000) // the server allows one code a minute
    },
    onError: (e: ApiError) => {
      if (e.status === 429 && e.value?.retryAfter) {
        setNow(Date.now())
        setResendAt(Date.now() + e.value.retryAfter * 1000)
      }
    },
  })
  const verify = useMutation({
    mutationFn: (c: string) => unwrap(api.auth.verify.post({ email: cleanEmail, code: c })),
    onSuccess: (r) => nav({ to: r.onboarded ? (redirect ?? "/discover") : "/onboarding" }),
  })

  const sendError = (() => {
    const e = send.error as ApiError | null
    if (!e) return null
    if (e.status === 429) {
      const n = e.value?.retryAfter ?? 60
      return n <= 90 ? `You asked for a code a moment ago. Try again in ${wait(n)}.` : `You have asked for several codes. Try again in ${wait(n)}.`
    }
    if (e.value?.error === "university_email_required") return "Use your university email address, which ends in .edu.ng."
    return "We could not send a code. Check your connection and try again."
  })()
  const verifyError = (() => {
    const e = verify.error as ApiError | null
    if (!e) return null
    if (e.status === 429) return `Too many tries. Wait ${wait(e.value?.retryAfter ?? 900)}, then ask for a new code.`
    if (e.value?.error === "code_expired") return "That code has expired. Send a new one below."
    if (e.value?.error === "account_suspended") return "This account is suspended."
    return "That code is not right. Check the newest email, or send a new code."
  })()

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-5">
      <header className="flex items-center justify-between">
        <Brand />
        <span className="label">Step {step === "email" ? 1 : 2} of 3</span>
      </header>
      {step === "email" ? (
        <form
          className="flex flex-1 flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (okEmail) send.mutate()
          }}
        >
          <div className="space-y-2">
            <h1 className="text-[28px] font-bold leading-[34px]">
              Verify your campus email
            </h1>
            <p className="text-ink-2">
              Only students with a university address can join. We send a
              6-digit code to confirm it is yours.
            </p>
          </div>
          <label className="space-y-2 text-sm font-semibold">
            University email
            <input
              className="input mt-2 font-normal"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="name@st.futminna.edu.ng"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {looksPersonal && (
            <p role="alert" className="text-sm text-danger">
              Use an address that ends in .edu.ng
            </p>
          )}
          {sendError && (
            <p role="alert" className="text-sm text-danger">
              {sendError}
            </p>
          )}
          <button className="btn" disabled={!okEmail || send.isPending}>
            {send.isPending ? "Sending…" : "Send Code"}
          </button>
        </form>
      ) : (
        <form
          className="flex flex-1 flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.length === 6) verify.mutate(code)
          }}
        >
          <div className="space-y-2">
            <h1 className="text-[28px] font-bold leading-[34px]">
              Enter the 6-digit code
            </h1>
            <p className="text-ink-2">
              Sent to <b className="text-ink">{cleanEmail}</b>. It expires in 10
              minutes.
            </p>
            <p className="text-[13px] text-ink-2">
              Not there yet? University email can take a few minutes, and codes
              sometimes land in spam or junk.
            </p>
          </div>
          <input
            className="input h-14 font-mono text-2xl tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            placeholder="000000"
            aria-label="Verification code"
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6)
              setCode(v)
              if (v.length === 6 && !verify.isPending) verify.mutate(v) // no need to press a button
            }}
          />
          {verifyError && (
            <p role="alert" className="text-sm text-danger">
              {verifyError}
            </p>
          )}
          {sendError && (
            <p role="alert" className="text-sm text-danger">
              {sendError}
            </p>
          )}
          {send.isSuccess && !send.isPending && secondsLeft > 0 && !verifyError && (
            <p role="status" className="text-sm text-ink-2">
              A code is on its way.
            </p>
          )}
          <button
            className="btn"
            disabled={code.length !== 6 || verify.isPending}
          >
            {verify.isPending ? "Checking…" : "Verify Email"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={secondsLeft > 0 || send.isPending}
            onClick={() => {
              verify.reset()
              send.mutate()
            }}
          >
            {send.isPending ? "Sending…" : secondsLeft > 0 ? `Send a new code in ${secondsLeft}s` : "Send a new code"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setStep("email")
              setCode("")
              verify.reset()
              send.reset()
            }}
          >
            Change Email
          </button>
        </form>
      )}
    </main>
  )
}
