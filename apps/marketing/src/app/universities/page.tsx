import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '~/components/PageShell'
import { Contact } from '~/components/Contact'

export const metadata: Metadata = { title: 'For universities', description: 'What Met On Campus is, how a campus community is formed, how students are verified, and how moderation works.', alternates: { canonical: '/universities' } }

export default function Universities() {
  return (
    <PageShell title="For universities." lede="Met On Campus helps students at the same university find study partners, friends and, if they choose, dates. This page explains how it works for student affairs teams and administrators.">
      <h2>What it is</h2>
      <p>A web app where students from one university meet each other for three separate purposes: studying together, making friends, and dating. Each purpose is its own mode with its own profile and inbox, and students choose which ones to turn on.</p>

      <h2>How a campus community forms</h2>
      <p>Students join with a university email address ending in .edu.ng, confirmed by a one-time code. The university is read from the email domain, and students only see other students from the same university. A university does not need to install anything or connect any systems for its students to use the app.</p>

      <h2>How students are kept safe</h2>
      <ul>
        <li>Meetups can only be proposed at public campus spots.</li>
        <li>Romance mode requires both people to opt in, and students can hide from their own department.</li>
        <li>Students can block and report people. Our team reviews reports and can suspend accounts.</li>
        <li>Our staff cannot browse private chats. They see only a message that was reported.</li>
      </ul>
      <p>The full picture is on our <Link href="/safety">safety page</Link>.</p>

      <h2>Student data</h2>
      <p>We collect only what the app needs to work: the university email, a name, department and level, the profile text a student writes, and their activity in the app. Details are in our <Link href="/privacy">privacy policy</Link>. The app does not use advertising trackers.</p>

      <h2>Talk to us</h2>
      <p>If you work at a university and want to ask about the app, how we handle reports, or how to raise a concern about a student, reach us at <Contact />.</p>
    </PageShell>
  )
}
