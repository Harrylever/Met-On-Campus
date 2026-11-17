export const site = {
  name: 'Met On Campus',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://metoncampus.xyz',
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.metoncampus.xyz',
  // Public contact address (Cloudflare Email Routing forwards it). NEXT_PUBLIC_CONTACT_EMAIL overrides it at build time.
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@metoncampus.xyz',
  updated: '17 November 2026', // bump when terms or privacy change
}
