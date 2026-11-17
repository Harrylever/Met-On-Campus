import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '~/components/PageShell'
import { site } from '~/lib/site'

export const metadata: Metadata = { title: 'Safety and privacy', description: 'How verification, modes, blocking, reporting and Romance mode privacy work on Met On Campus, and what our team can and cannot see.', alternates: { canonical: '/safety' } }

export default function Safety() {
  return (
    <PageShell title="How safety works." lede="Meeting new people takes some trust. Here is what we do to make that easier, what we cannot do, and what you can do yourself.">
      <h2>Everyone is a verified student</h2>
      <p>To join, you enter your university email address and we send a 6-digit code to it. Only addresses ending in .edu.ng are accepted. You only see students from your own university.</p>
      <p>Verification proves that someone controls a university inbox. It does not prove who they are or what they are like, so please use the same judgement you would with anyone you meet for the first time.</p>

      <h2>Your modes stay separate</h2>
      <p>Study, Friends and Romance each have their own profile and their own inbox. A person only sees the profile for the mode where they found you, and a chat in one mode never appears in another.</p>

      <h2>Romance mode is opt-in on both sides</h2>
      <ul>
        <li>You are only shown to students who also turned Romance on, and you only see them.</li>
        <li>You can hide your Romance profile from students in your own department.</li>
        <li>There are no group rooms for Romance. Meetups are arranged one to one in Messages.</li>
      </ul>

      <h2>Meetups happen in public</h2>
      <p>When you suggest meeting, you choose from public campus spots such as the University Library, the Faculty Quad or the Student Union cafeteria. You cannot suggest a private address. The other person can accept or decline.</p>
      <h3>Tips for meeting someone new</h3>
      <ul>
        <li>Pick a busy time and place, and tell a friend where you are going.</li>
        <li>Keep your personal contact details to yourself until you are comfortable.</li>
        <li>If something feels wrong, leave. You do not owe anyone an explanation.</li>
        <li>In an emergency, call 112 or campus security first.</li>
      </ul>

      <h2>Blocking</h2>
      <p>You can block anyone from their profile card or from your chat with them. It takes effect straight away and works both ways: you stop seeing each other in search results and rooms, and the conversation is hidden and closed for both of you. You can undo it from your profile.</p>

      <h2>Reporting</h2>
      <p>You can report a profile or a single message. Choose a reason such as harassment, feeling unsafe, inappropriate content, a fake profile or spam, add details if you want, and choose whether to block the person at the same time.</p>
      <p>Our team reviews each report. We can dismiss it, record a warning, or suspend the account. A suspended student is signed out immediately and hidden from everyone else. You may not always be told what the outcome was.</p>

      <h2>What our team can and cannot see</h2>
      <ul>
        <li><strong>Can see:</strong> account and profile details, how active an account is, who has reported or blocked whom, and the saved text of a message that was reported.</li>
        <li><strong>Cannot see:</strong> your private messages, unless you or the other person reported that specific message.</li>
        <li><strong>Accountability:</strong> every sign-in by our staff, every search, every time a profile is opened and every moderation action is recorded in a log.</li>
      </ul>

      <h2>What we cannot promise</h2>
      <p>No online service can guarantee that everyone behaves well. We built these protections to reduce risk and to act quickly when something goes wrong, and we rely on you to report problems. See our <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy policy</Link> for the details.</p>
      <p><a href={site.appUrl}>Open the app</a> when you are ready.</p>
    </PageShell>
  )
}
