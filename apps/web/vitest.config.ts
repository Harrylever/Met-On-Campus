import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.ts: that one loads the TanStack Start and Nitro plugins, which tests do not need.
export default defineConfig({
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
