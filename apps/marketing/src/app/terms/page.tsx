import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '~/components/PageShell'
import { Contact } from '~/components/Contact'
import { site } from '~/lib/site'

export const metadata: Metadata = { title: 'Terms of service', description: 'The rules for using Met On Campus.', alternates: { canonical: '/terms' } }

// NOTE FOR THE TEAM: this is a plain-language starting point written from how the product works today.
// Have a Nigerian lawyer review it (especially sections 2, 8, 9 and 10) before relying on it.
export default function Terms() {
  return (
    <PageShell title="Terms of service" updated={site.updated} lede="These terms are the agreement between you and Met On Campus. Please read them before you use the app.">
      <h2>1. Who we are</h2>
      <p>Met On Campus (&quot;we&quot;, &quot;us&quot;) runs the website at {site.url.replace('https://', '')} and the app at {site.appUrl.replace('https://', '')}. You can reach us at <Contact />.</p>

      <h2>2. Who can use the app</h2>
      <ul>
        <li>You must be a student or staff member of a university and control an email address ending in .edu.ng.</li>
        <li>You must be at least 18 to turn on Romance mode. We do not currently check age, so you are responsible for following this rule.</li>
        <li>You must give accurate information about yourself and keep your account to yourself.</li>
      </ul>

      <h2>3. How the app works</h2>
      <p>You choose which modes to turn on: Study, Friends and Romance. Each has its own profile and inbox. You can send invitations, message people you are connected to, suggest meetups at public campus spots, and join rooms for Study and Friends. Features may change as we improve the app.</p>

      <h2>4. Rules</h2>
      <p>You agree not to:</p>
      <ul>
        <li>harass, threaten, bully or pressure anyone, or keep contacting someone who has asked you to stop;</li>
        <li>pretend to be someone else, or use photos or details that are not yours;</li>
        <li>send spam, advertising or anything unrelated to meeting other students;</li>
        <li>share sexual content, hate speech, or anything illegal;</li>
        <li>ask for or share someone&apos;s private information without their consent;</li>
        <li>try to break, scrape, overload or get around the app&apos;s protections, or use it to build another service.</li>
      </ul>

      <h2>5. Meeting people in person</h2>
      <p>We confirm that you control a university email address. We do not run background checks and we cannot confirm who anyone is or what they are like. You decide whether to meet someone and you are responsible for your own safety. Use public places, tell a friend, and read our <Link href="/safety">safety page</Link>.</p>

      <h2>6. Your content</h2>
      <p>You keep ownership of what you write on your profile and in messages. You give us permission to store it and show it to other students as the app is designed to, for as long as your account exists. You are responsible for what you post.</p>

      <h2>7. Moderation</h2>
      <p>Students can report profiles and messages. We review reports and can dismiss them, record a warning, or suspend an account. A suspended account is signed out and hidden from other students. We may act without notice where we think it is needed to keep people safe.</p>

      <h2>8. No guarantees</h2>
      <p>We work to keep the app available and safe, but we provide it &quot;as is&quot;. We do not promise that it will always work, that it will be free of errors, or that every student on it will behave well.</p>

      <h2>9. Our responsibility to you</h2>
      <p>To the extent the law allows, we are not responsible for loss or harm that comes from what other users do, from meetings you arrange, or from the app being unavailable. Nothing in these terms limits any responsibility we cannot lawfully limit.</p>

      <h2>10. Ending your account</h2>
      <p>You can stop using the app at any time. To ask us to delete your account, contact us at <Contact />. We can also close accounts that break these terms.</p>

      <h2>11. Changes</h2>
      <p>We may update these terms. When we make a significant change, we will tell you in the app or by email. Using the app after a change means you accept it.</p>

      <h2>12. Governing law</h2>
      <p>These terms are governed by the laws of the Federal Republic of Nigeria.</p>
      <p>How we handle your personal data is described in our <Link href="/privacy">privacy policy</Link>.</p>
    </PageShell>
  )
}
