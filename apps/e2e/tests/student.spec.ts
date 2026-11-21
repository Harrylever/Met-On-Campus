import { expect, test, type PlaywrightWorkerArgs } from '@playwright/test'
import { URLS } from '../env'
import { browserAs, makePremium, makeStudent, uniqueEmail, type Student } from './helpers'

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

test("a student's gender icon appears on their card once set, and there is no \"Prefer not to say\" option", async ({ browser, playwright }) => {
  const amara = await makeStudent(playwright, 'Amara')
  const viewer = await makeStudent(playwright, 'Viewer')

  const amaraPage = await (await browserAs(browser, amara)).newPage()
  await amaraPage.goto('/profile')
  const gender = amaraPage.getByLabel('Gender (optional)')
  await expect(gender.locator('option', { hasText: 'Prefer not to say' })).toHaveCount(0)
  await gender.selectOption('female')
  await amaraPage.getByRole('button', { name: 'Save details' }).click()
  await expect(amaraPage.getByRole('button', { name: 'Saved' })).toBeVisible()
  // Once set there is nothing to go back to: only Male and Female remain.
  await expect(gender.locator('option')).toHaveText(['Male', 'Female'])

  const viewerPage = await (await browserAs(browser, viewer)).newPage()
  await viewerPage.goto('/discover')
  const card = viewerPage.getByRole('article').filter({ hasText: 'Amara' })
  await expect(card.getByRole('img', { name: 'Female' })).toBeVisible()
})

test("the per-mode gender switch is there as soon as a gender is picked, before it is saved", async ({ browser, playwright }) => {
  const amara = await makeStudent(playwright, 'Amara')
  const page = await (await browserAs(browser, amara)).newPage()
  await page.goto('/profile')
  await expect(page.getByRole('switch', { name: /Show my gender on my cards/ })).toHaveCount(0)
  await page.getByLabel('Gender (optional)').selectOption('female')
  await expect(page.getByRole('switch', { name: /Show my gender on my cards/ }).first()).toBeVisible()
})

/** Calls the API as this student (their own cookie jar), for setting rooms up faster than the UI. */
async function apiAs(playwright: PlaywrightWorkerArgs['playwright'], student: Student) {
  return playwright.request.newContext({ extraHTTPHeaders: { cookie: `moc_session=${student.token}` } })
}

const hour = 60 * 60_000
const onlineRoom = (title: string, startsInMs: number) => ({
  intent: 'study', mode: 'online', tag: 'CSS 411', title,
  startsAt: new Date(Date.now() + startsInMs).toISOString(), endsAt: new Date(Date.now() + startsInMs + hour).toISOString(), capacity: 5,
})

test('a premium host creates an online room and sees the Online tag', async ({ browser, playwright }) => {
  const host = await makeStudent(playwright, 'Premhost')
  await makePremium(host)
  const page = await (await browserAs(browser, host)).newPage()
  await page.goto('/rooms')
  await page.getByRole('button', { name: 'Host a Study Room' }).click()
  await page.getByLabel('Tag').fill('CSS 411')
  await page.getByLabel('Title').fill('Premium voice revision')
  await page.getByRole('button', { name: 'Online', exact: true }).click()
  await expect(page.getByText('Online rooms are a premium feature.')).toHaveCount(0)
  await page.getByRole('button', { name: 'Create Room' }).click()
  const card = page.getByRole('article').filter({ hasText: 'Premium voice revision' })
  await expect(card.getByText('Online', { exact: true })).toBeVisible()
})

test('a non-premium host can create an online room, limited to 5 minutes', async ({ browser, playwright }) => {
  const host = await makeStudent(playwright, 'Freehost')
  const page = await (await browserAs(browser, host)).newPage()
  await page.goto('/rooms')
  await page.getByRole('button', { name: 'Host a Study Room' }).click()
  await page.getByLabel('Tag').fill('CSS 411')
  await page.getByLabel('Title').fill('Free voice revision')
  await page.getByRole('button', { name: 'Online', exact: true }).click()
  await expect(page.getByText('Online rooms are a premium feature.')).toHaveCount(0)
  const length = page.getByLabel('Length')
  await expect(length).toHaveValue('5')
  await expect(length.locator('option', { hasText: '5 min' })).toHaveCount(1)
  await expect(length.locator('option', { hasText: '10 min' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Create Room' }).click()
  const card = page.getByRole('article').filter({ hasText: 'Free voice revision' })
  await expect(card.getByText('Online', { exact: true })).toBeVisible()
})

test('an approved member sees "Join voice" while the room is live, and an unapproved student never does', async ({ browser, playwright }) => {
  const host = await makeStudent(playwright, 'Livehost')
  await makePremium(host)
  const member = await makeStudent(playwright, 'Member')
  const outsider = await makeStudent(playwright, 'Outsider')

  const hostApi = await apiAs(playwright, host)
  const memberApi = await apiAs(playwright, member)
  try {
    const created = await hostApi.post(`${URLS.api}/rooms`, { data: onlineRoom('Live voice revision', -5 * 60_000) })
    expect(created.ok()).toBeTruthy()
    const roomId = (await created.json()).room.id
    expect((await memberApi.post(`${URLS.api}/rooms/${roomId}/request`)).ok()).toBeTruthy()
    const memberId = (await (await memberApi.get(`${URLS.api}/me`)).json()).user.id
    expect((await hostApi.post(`${URLS.api}/rooms/${roomId}/requests/${memberId}`, { data: { decision: 'approved' } })).ok()).toBeTruthy()
  } finally { await hostApi.dispose(); await memberApi.dispose() }

  const memberPage = await (await browserAs(browser, member)).newPage()
  await memberPage.goto('/rooms')
  const memberCard = memberPage.getByRole('article').filter({ hasText: 'Live voice revision' })
  await expect(memberCard.getByRole('button', { name: 'Join voice' })).toBeVisible()

  const outsiderPage = await (await browserAs(browser, outsider)).newPage()
  await outsiderPage.goto('/rooms')
  const outsiderCard = outsiderPage.getByRole('article').filter({ hasText: 'Live voice revision' })
  await expect(outsiderCard.getByRole('button', { name: 'Request Spot' })).toBeVisible()
  await expect(outsiderPage.getByRole('button', { name: 'Join voice' })).toHaveCount(0)
})

test('an upcoming online room shows no Join voice button', async ({ browser, playwright }) => {
  const host = await makeStudent(playwright, 'Soonhost')
  await makePremium(host)
  const hostApi = await apiAs(playwright, host)
  try {
    expect((await hostApi.post(`${URLS.api}/rooms`, { data: onlineRoom('Upcoming voice revision', 2 * hour) })).ok()).toBeTruthy()
  } finally { await hostApi.dispose() }

  const page = await (await browserAs(browser, host)).newPage()
  await page.goto('/rooms')
  const card = page.getByRole('article').filter({ hasText: 'Upcoming voice revision' })
  await expect(card).toBeVisible()
  await expect(page.getByRole('button', { name: 'Join voice' })).toHaveCount(0)
})
