import type { Metadata, Viewport } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import { Header } from '~/components/Header'
import { Footer } from '~/components/Footer'
import { site } from '~/lib/site'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-grotesk', weight: ['500', '600', '700'] })

const description = 'Find study partners, friends and, if you want, someone to date, all verified students at your university. Meet in public campus spots.'
export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: 'Met On Campus: find your people on campus', template: '%s | Met On Campus' },
  description,
  openGraph: { type: 'website', siteName: site.name, title: 'Met On Campus: find your people on campus', description, url: site.url },
  twitter: { card: 'summary_large_image', title: 'Met On Campus: find your people on campus', description },
  alternates: { canonical: '/' },
}
export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#FAF9F6' }, { media: '(prefers-color-scheme: dark)', color: '#111110' }] }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable}`} suppressHydrationWarning>
      <head>
        {/* Runs before first paint: apply the saved choice, else the system setting, so there is no flash of the wrong theme.
            Without JavaScript the CSS falls back to the system setting on its own. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('moc-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()` }} />
      </head>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-canvas">Skip to content</a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
