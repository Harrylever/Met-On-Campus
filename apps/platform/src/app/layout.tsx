import type { Metadata } from 'next'
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-grotesk', weight: ['600', '700'] })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', weight: ['500'] })

// The CSP uses a per-request nonce (src/proxy.ts). Static prerendering cannot carry one, so every page renders per request.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Met On Campus Platform', robots: { index: false, follow: false } }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  )
}
