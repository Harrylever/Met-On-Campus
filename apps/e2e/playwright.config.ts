import { defineConfig, devices } from "@playwright/test"
import { API_ENV, PORTS, URLS } from "./env"

export const STAFF_STATE = "playwright/.auth/staff.json"

export default defineConfig({
  testDir: "./tests",
  // One database shared by every test, so one worker.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: URLS.web,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  // Never reuse a server that is already running: it could be pointed at a real database.
  webServer: [
    {
      command: "bun src/server.ts",
      cwd: "../api",
      url: `${URLS.api}/health`,
      env: API_ENV,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `bunx vite dev --port ${PORTS.web} --strictPort`,
      cwd: "../web",
      url: `${URLS.web}/login`,
      env: { VITE_API_URL: URLS.api },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `bunx next dev -p ${PORTS.platform}`,
      cwd: "../platform",
      url: `${URLS.platform}/login`,
      env: {
        ADMIN_API_URL: URLS.api,
        ADMIN_API_TOKEN: API_ENV.ADMIN_API_TOKEN!,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
