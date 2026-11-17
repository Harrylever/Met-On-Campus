import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import css from '../styles.css?url'

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: false } } })

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Met On Campus' }],
    links: [
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&family=Space+Grotesk:wght@600;700&display=swap' },
      { rel: 'stylesheet', href: css },
    ],
  }),
  shellComponent: ({ children }: { children: ReactNode }) => (
    <html lang="en"><head><HeadContent /></head><body>{children}<Scripts /></body></html>
  ),
  component: () => <QueryClientProvider client={queryClient}><Outlet /></QueryClientProvider>,
})
