import { expect, test } from '@playwright/test'
import { URLS } from '../env'
import { browserAs, makeStudent, uniqueEmail } from './helpers'

test('a new student signs in with an emailed code, finishes onboarding and reaches Discover', async ({ page }) => {
  const email = uniqueEmail('newcomer')
  await page.goto('/login')
  await page.getByLabel('University email').fill(email)
  await page.getByRole('button', { name: 'Send Code' }).click()
  await expect(page.getByRole('heading', { name: 'Enter the 6-digit code' })).toBeVisible()

  const { code } = await (await page.request.get(`${URLS.api}/dev/outbox/${email}`)).json()
  await page.getByLabel('Verification code').fill(code)           // six digits submit by themselves

  await expect(page.getByRole('heading', { name: 'What are you here for' })).toBeVisible()
  await page.getByLabel('What should we call you?').fill('Amina')
  await page.getByRole('button', { name: 'Enter Campus' }).click()
  await expect(page).toHaveURL(/\/discover/)
  await expect(page.getByRole('heading', { name: 'Study partners on campus' })).toBeVisible()
})

test('an address outside the campus student domain is turned away and told which domain to use', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('University email').fill('lecturer@futminna.edu.ng')
  await page.getByRole('button', { name: 'Send Code' }).click()
  await expect(page.getByRole('alert')).toContainText('@st.futminna.edu.ng')
  await expect(page.getByRole('heading', { name: 'Enter the 6-digit code' })).toHaveCount(0)   // no code was sent
})

test('a wrong code is refused and the student stays on the sign-in step', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('University email').fill(uniqueEmail('wrongcode'))
  await page.getByRole('button', { name: 'Send Code' }).click()
  await page.getByLabel('Verification code').fill('000000')
  await expect(page.getByRole('alert')).toContainText('not right')
  await expect(page).toHaveURL(/\/login/)
})

test('one student invites another, who sees the invite in Messages and accepts it', async ({ browser, playwright }) => {
  const amina = await makeStudent(playwright, 'Amina')
  const tunde = await makeStudent(playwright, 'Tunde')

  const aminaPage = await (await browserAs(browser, amina)).newPage()
  await aminaPage.goto('/discover')
  const card = aminaPage.getByRole('article').filter({ hasText: 'Tunde' })
  await card.getByRole('button', { name: 'Invite to Study' }).click()
  await expect(card.getByRole('button', { name: 'Invite Sent' })).toBeDisabled()

  const tundePage = await (await browserAs(browser, tunde)).newPage()
  await tundePage.goto('/messages?intent=study')
  await expect(tundePage.getByText('invited you to study together')).toBeVisible()
  await tundePage.getByRole('button', { name: 'Accept' }).click()
  await expect(tundePage.getByRole('button', { name: 'Accept' })).toHaveCount(0)
  await expect(tundePage.getByText('Accept to start chatting')).toHaveCount(0)
})

test('Discover loads with nothing wrong in the browser console (no invalid HTML, no hydration errors)', async ({ browser, playwright }) => {
  const student = await makeStudent(playwright, 'Quiet')
  const page = await (await browserAs(browser, student)).newPage()
  const problems: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()) })
  page.on('pageerror', (e) => problems.push(e.message))
  await page.goto('/discover')
  await expect(page.getByRole('heading', { name: 'Study partners on campus' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(problems).toEqual([])
})

test("a student's gender icon appears on their card, and disappears when they clear it", async ({ browser, playwright }) => {
  const amara = await makeStudent(playwright, 'Amara')
  const viewer = await makeStudent(playwright, 'Viewer')

  const amaraPage = await (await browserAs(browser, amara)).newPage()
  await amaraPage.goto('/profile')
  await amaraPage.getByLabel('Gender (optional)').selectOption('female')
  await amaraPage.getByRole('button', { name: 'Save details' }).click()
  await expect(amaraPage.getByRole('button', { name: 'Saved' })).toBeVisible()

  const viewerPage = await (await browserAs(browser, viewer)).newPage()
  await viewerPage.goto('/discover')
  const card = viewerPage.getByRole('article').filter({ hasText: 'Amara' })
  await expect(card.getByRole('img', { name: 'Female' })).toBeVisible()

  await amaraPage.getByLabel('Gender (optional)').selectOption('')
  await amaraPage.getByRole('button', { name: 'Save details' }).click()
  await expect(amaraPage.getByRole('button', { name: 'Saved' })).toBeVisible()

  await viewerPage.reload()
  await expect(viewerPage.getByRole('article').filter({ hasText: 'Amara' })).toBeVisible()
  await expect(viewerPage.getByRole('img', { name: 'Female' })).toHaveCount(0)
})

test("the per-mode gender switch is there as soon as a gender is picked, before it is saved", async ({ browser, playwright }) => {
  const amara = await makeStudent(playwright, 'Amara')
  const page = await (await browserAs(browser, amara)).newPage()
  await page.goto('/profile')
  await expect(page.getByRole('switch', { name: /Show my gender on my cards/ })).toHaveCount(0)
  await page.getByLabel('Gender (optional)').selectOption('female')
  await expect(page.getByRole('switch', { name: /Show my gender on my cards/ }).first()).toBeVisible()
})
