export const site = {
  name: 'Met On Campus',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://metoncampus.xyz',
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.metoncampus.xyz',
  // Public contact address (Cloudflare Email Routing forwards it). NEXT_PUBLIC_CONTACT_EMAIL overrides it at build time.
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@metoncampus.xyz',
  // The public source code. Open source under the AGPL-3.0 (see LICENSE in the repository).
  repo: { owner: 'Harrylever', name: 'Met-On-Campus', url: 'https://github.com/Harrylever/Met-On-Campus' },
  updated: '17 November 2026', // bump when terms or privacy change
}
