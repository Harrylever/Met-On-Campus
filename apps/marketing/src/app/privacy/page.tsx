import type { Metadata } from 'next'
import Link from 'next/link'
import { PageShell } from '~/components/PageShell'
import { Contact } from '~/components/Contact'
import { site } from '~/lib/site'

export const metadata: Metadata = { title: 'Privacy policy', description: 'What personal data Met On Campus collects, why, who we share it with, and your choices.', alternates: { canonical: '/privacy' } }

// NOTE FOR THE TEAM: written from how the product works today. Have a Nigerian lawyer review it before relying on it,
// and confirm the retention, deletion and regulator statements. Update it whenever data practices change.
export default function Privacy() {
  return (
    <PageShell title="Privacy policy" updated={site.updated} lede="This explains what personal data we collect when you use Met On Campus, why we collect it, and the choices you have.">
      <h2>What we collect</h2>
      <ul>
        <li><strong>Your account:</strong> your university email address, your name (a first name or nickname), department and level, and which university you belong to (worked out from your email domain). Other students never see your email address.</li>
        <li><strong>Your profiles:</strong> what you write for each mode, such as a short prompt, a bio, interests, when you are usually free, a usual spot, and your privacy choices.</li>
        <li><strong>What you do in the app:</strong> invitations you send and receive and how you answer them, messages and meetup suggestions, rooms you host or ask to join, people you block, and reports you make or that are made about you.</li>
        <li><strong>Photos:</strong> if you add a profile photo (optional, one for each mode), we store a resized copy. We remove the extra information phones add to pictures, including location, and keep only the image.</li>
        <li><strong>Presence:</strong> while the app is open, we note that you are online. This is held temporarily and expires by itself about a minute and a half after you leave. We do not read your device&apos;s location.</li>
        <li><strong>Sign-in and security data:</strong> a session cookie that keeps you signed in, a record of sign-in codes (stored in a scrambled form and expiring after 10 minutes), and your IP address, which we use briefly to limit abuse.</li>
      </ul>
      <p>We do not use advertising trackers. This website sets no cookies.</p>

      <h2>Why we use it</h2>
      <ul>
        <li>To confirm you are a student and let you sign in.</li>
        <li>To show you to, and connect you with, other students in the way you chose.</li>
        <li>To keep people safe: preventing abuse, reviewing reports, and suspending accounts.</li>
        <li>To keep the service running and secure.</li>
      </ul>

      <h2>Who can see your data</h2>
      <ul>
        <li><strong>Other students</strong> see the profile for the mode where they find you. They do not see your email.</li>
        <li><strong>Your photos</strong> are checked by our team before anyone else can see them. Other students see a photo only in the mode you added it to, and in Romance only once you have both said yes. Until a photo is approved, only you can see it.</li>
        <li><strong>Our staff</strong> can see account and profile details, including your email and any photo waiting for review, when handling safety reports or support. They cannot read your private messages, except a specific message that was reported. Staff access is logged.</li>
        <li><strong>Service providers</strong> that help us run the app: a hosting provider for our servers, database and photo storage, a web hosting provider for the website and app front end, and an email provider that delivers your sign-in codes. They process data for us and not for their own purposes.</li>
        <li><strong>Authorities</strong>, if the law requires it or to protect someone&apos;s safety.</li>
      </ul>
      <p>We do not sell your personal data. Some of our providers run servers outside Nigeria, so your data may be processed in other countries.</p>

      <h2>How long we keep it</h2>
      <p>We keep your data while your account is active. When you ask us to delete your account, we delete your profile, messages and photos. If you remove or replace a photo, or we do not approve it, the stored file is deleted. We may keep limited records, such as reports and moderation actions, where needed for safety or to meet legal obligations.</p>

      <h2>Your choices and rights</h2>
      <p>You can edit your profiles and turn modes off at any time in the app, and you can block people. You can also ask us to give you a copy of your data, correct it, or delete your account. Contact us at <Contact />. Under Nigerian data protection law you may also complain to the Nigeria Data Protection Commission.</p>

      <h2>Children</h2>
      <p>The app is for university students. Romance mode is for adults aged 18 and over.</p>

      <h2>Changes</h2>
      <p>If we change how we handle personal data, we will update this page and tell you in the app. Our <Link href="/terms">terms</Link> explain the rules for using the app.</p>
    </PageShell>
  )
}
