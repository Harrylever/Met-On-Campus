import Link from 'next/link'

export default function NotFound() {
  return (
    <section className="container-x py-28">
      <h1 className="text-[clamp(2.4rem,5.5vw,4rem)]">That page does not exist.</h1>
      <p className="mt-4 max-w-[48ch] text-lg text-ink-2">It may have moved, or the link may be wrong.</p>
      <Link href="/" className="btn mt-8">Back to the home page</Link>
    </section>
  )
}
