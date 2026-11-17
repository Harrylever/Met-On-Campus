import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

export default defineConfig({
  // strictPort: the API's CORS origin is http://localhost:3000, so drifting to another port breaks sign-in.
  server: { port: 3000, strictPort: true },
  resolve: { tsconfigPaths: true },
  // nitro() turns the Start build into a deployable server; on Vercel it emits .vercel/output automatically.
  plugins: [tailwindcss(), tanstackStart(), nitro(), viteReact()],
})
