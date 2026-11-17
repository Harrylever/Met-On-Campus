import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation } from "@tanstack/react-query"
import { api, unwrap } from "~/lib/api"
import { Brand } from "~/components/ui"

export const Route = createFileRoute("/login")({ ssr: false, component: Login })

function Login() {
  const nav = useNavigate()
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"email" | "code">("email")
  const okEmail = /^[^@\s]+@[^@\s]+\.edu\.ng$/i.test(email.trim())
  const looksPersonal = !okEmail && /@[^@\s]+\.[a-z]{2,}$/i.test(email.trim())

  const send = useMutation({
    mutationFn: () => unwrap(api.auth["request-code"].post({ email })),
    onSuccess: () => setStep("code"),
  })
  const verify = useMutation({
    mutationFn: () => unwrap(api.auth.verify.post({ email, code })),
    onSuccess: (r) => nav({ to: r.onboarded ? "/discover" : "/onboarding" }),
  })

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
            okEmail && send.mutate()
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
          {send.isError && (
            <p role="alert" className="text-sm text-danger">
              Could not send a code. Check the address and try again.
            </p>
          )}
          <button className="btn" disabled={!okEmail || send.isPending}>
            Send Code
          </button>
        </form>
      ) : (
        <form
          className="flex flex-1 flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            code.length === 6 && verify.mutate()
          }}
        >
          <div className="space-y-2">
            <h1 className="text-[28px] font-bold leading-[34px]">
              Enter the 6-digit code
            </h1>
            <p className="text-ink-2">
              Sent to <b className="text-ink">{email}</b>. It expires in 10
              minutes.
            </p>
          </div>
          <input
            className="input h-14 font-mono text-2xl tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            aria-label="Verification code"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
          />
          {verify.isError && (
            <p role="alert" className="text-sm text-danger">
              That code is wrong or expired.
            </p>
          )}
          <button
            className="btn"
            disabled={code.length !== 6 || verify.isPending}
          >
            Verify Email
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setStep("email")
              setCode("")
            }}
          >
            Change Email
          </button>
        </form>
      )}
    </main>
  )
}
