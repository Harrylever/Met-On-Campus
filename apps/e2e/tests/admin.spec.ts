import { expect, test } from '@playwright/test'
import { URLS } from '../env'
import { STAFF_STATE } from '../playwright.config'

test.use({ storageState: STAFF_STATE })

test('opening a university with a student domain makes its sign-up rule real in the student app', async ({ page, browser }) => {
  await page.goto(`${URLS.platform}/campuses`)
  await page.getByLabel('Name', { exact: true }).fill('Ahmadu Bello University')
  await page.getByLabel('Student email domain').fill('st.abu.edu.ng')
  await expect(page.getByLabel('Short name')).toHaveValue('abu')       // filled in from the domain
  await page.getByRole('button', { name: 'Open university' }).click()
  await expect(page.getByRole('row', { name: /Ahmadu Bello University.*st\.abu\.edu\.ng/ })).toBeVisible()

  const student = await (await browser.newContext({ baseURL: URLS.web })).newPage()
  await student.goto('/login')
  await student.getByLabel('University email').fill('prof@abu.edu.ng')
  await student.getByRole('button', { name: 'Send Code' }).click()
  await expect(student.getByRole('alert')).toContainText('@st.abu.edu.ng')

  await student.getByLabel('University email').fill(`amina${Date.now().toString(36)}@st.abu.edu.ng`)
  await student.getByRole('button', { name: 'Send Code' }).click()
  await expect(student.getByRole('heading', { name: 'Enter the 6-digit code' })).toBeVisible()
})

test('a domain that does not belong to the university is refused and nothing changes', async ({ page }) => {
  await page.goto(`${URLS.platform}/campuses`)
  const row = page.locator('tr', { hasText: 'futminna' })
  await row.getByRole('button', { name: 'Edit' }).click()
  await row.getByLabel(/Student email domains/).fill('gmail.com')
  await row.getByRole('button', { name: 'Save' }).click()
  await expect(row.getByRole('alert')).toContainText('must belong to this university')
  await row.getByRole('button', { name: 'Cancel' }).click()
  await expect(row).toContainText('st.futminna.edu.ng')
})

test('Announcements says nobody can be reached while no student has notifications on', async ({ page }) => {
  await page.goto(`${URLS.platform}/announcements`)
  await expect(page.getByText('Nobody in this audience has notifications turned on.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review and send' })).toBeDisabled()
})
