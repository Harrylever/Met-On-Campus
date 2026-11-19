import { expect, test as setup } from '@playwright/test'
import { STAFF, URLS } from '../env'
import { STAFF_STATE } from '../playwright.config'
import { authenticatorCode } from './helpers'

// Staff sign-in is password plus an authenticator code, and a code works once. So sign in once here and let the admin tests
// reuse the saved session instead of signing in again.
setup('staff sign in with a password and an authenticator code', async ({ page }) => {
  await page.goto(`${URLS.platform}/login`)
  await page.getByLabel('Email').fill(STAFF.email)
  await page.getByLabel('Password').fill(STAFF.password)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Second step' })).toBeVisible()
  await page.getByLabel('Authenticator code').fill(authenticatorCode(STAFF.totpSecret))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText(STAFF.email, { exact: true })).toBeVisible()   // signed in: the sidebar shows who
  await page.context().storageState({ path: STAFF_STATE })
})
