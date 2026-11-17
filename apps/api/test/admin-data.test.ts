import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { adminAudit, reports, sessions } from '@moc/db'
import { db } from '../src/context'
import { devOutbox } from '../src/email'
import { adminCall, adminLogin, call, makeAdmin, makeUser, resetAll } from './helpers'

let S: string // staff session
const A = (m: string, p: string, body?: unknown) => adminCall(m, p, body, { session: S })

beforeEach(async () => { await resetAll(); S = await adminLogin(await makeAdmin()) })

async function reportedScenario() {
  const reporter = await makeUser('Amina'), bad = await makeUser('Tunde')
  const conv = (await call(reporter, 'POST', '/connections', { toUserId: bad.id, intent: 'study' })).json.conversationId as string
  const msg = (await call(bad, 'POST', `/conversations/${conv}/messages`, { kind: 'text', body: 'REPORTED-TEXT-123' })).json.message.id
  await call(reporter, 'POST', `/conversations/${conv}/messages`, { kind: 'text', body: 'PRIVATE-TEXT-456' })
  const rep = (await call(reporter, 'POST', '/reports', { userId: bad.id, reason: 'harassment', messageId: msg })).json.id as string
  return { reporter, bad, conv, rep }
}

describe('privacy', () => {
  test('no admin response contains private message text, only the reported snapshot', async () => {
    const { bad } = await reportedScenario()
    const bodies = await Promise.all(['/admin/overview', '/admin/activity', '/admin/health', '/admin/audit', `/admin/users/${bad.id}`, '/admin/users?q=Tunde'].map(async (p) => JSON.stringify((await A('GET', p)).json)))
    for (const b of bodies) { expect(b).not.toContain('PRIVATE-TEXT-456'); expect(b).not.toContain('REPORTED-TEXT-123') }
    const reports = JSON.stringify((await A('GET', '/admin/reports')).json)
    expect(reports).toContain('REPORTED-TEXT-123') // the one place text appears, by design
    expect(reports).not.toContain('PRIVATE-TEXT-456')
  })

  test('emails are masked in lists and the activity feed; full email only on a (audited) user view', async () => {
    const { bad, rep } = await reportedScenario()
    expect(JSON.stringify((await A('GET', '/admin/reports')).json)).not.toContain('@st.')
    expect(JSON.stringify((await A('GET', '/admin/activity')).json)).not.toContain('@st.')
    expect(JSON.stringify((await A('GET', '/admin/users?q=Tunde')).json)).not.toContain('tunde@')
    expect((await A('GET', `/admin/users/${bad.id}`)).json.user.email).toBe('tunde@st.futminna.edu.ng')
    expect((await db.select().from(adminAudit).where(eq(adminAudit.action, 'user.view'))).length).toBe(1)
    expect(rep).toBeTruthy()
  })
})

describe('reports and moderation', () => {
  test('lists open reports with context and counts', async () => {
    await reportedScenario()
    const r = (await A('GET', '/admin/reports')).json.reports
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ reason: 'harassment', status: 'open', intent: 'study', reporter: { name: 'Amina' }, reported: { name: 'Tunde', reportsAgainst: 1 } })
  })

  test('dismiss closes the report without touching the user', async () => {
    const { rep, bad } = await reportedScenario()
    expect((await A('POST', `/admin/reports/${rep}/resolve`, { action: 'dismiss', note: '' })).status).toBe(200)
    expect((await A('GET', '/admin/reports?status=dismissed')).json.reports).toHaveLength(1)
    expect((await A('GET', `/admin/users/${bad.id}`)).json.user.status).toBe('active')
  })

  test('warn and suspend need a written reason', async () => {
    const { rep } = await reportedScenario()
    expect((await A('POST', `/admin/reports/${rep}/resolve`, { action: 'suspend', note: 'no' })).status).toBe(422)
    expect((await A('POST', `/admin/reports/${rep}/resolve`, { action: 'warn', note: '   ' })).status).toBe(422)
  })

  test('a report can only be resolved once, even by simultaneous requests', async () => {
    const { rep } = await reportedScenario()
    const results = await Promise.all(Array.from({ length: 5 }, () => A('POST', `/admin/reports/${rep}/resolve`, { action: 'warn', note: 'first warning issued' })))
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(4)
  })

  test('suspending locks the student out immediately and everywhere', async () => {
    const { bad, reporter, conv, rep } = await reportedScenario()
    const other = await makeUser('Hauwa')
    expect((await call(bad, 'GET', '/me')).status).toBe(200)
    expect((await A('POST', `/admin/reports/${rep}/resolve`, { action: 'suspend', note: 'Repeated harassment of students' })).status).toBe(200)

    expect((await db.select().from(sessions).where(eq(sessions.userId, bad.id)))).toHaveLength(0) // sessions destroyed
    expect((await call(bad, 'GET', '/me')).status).toBe(401)
    // Their sessions are gone; even a restored one would be refused by the account check:
    expect((await call(bad, 'GET', '/discover?intent=study')).status).toBe(401)
    // Nobody else can find or reach them:
    expect((await call(other, 'GET', '/discover?intent=study')).json.cards.map((c: any) => c.name)).toEqual(['Amina'])
    expect((await call(other, 'POST', '/connections', { toUserId: bad.id, intent: 'study' })).status).toBe(403)
    expect((await call(reporter, 'GET', '/conversations?intent=study')).json.conversations).toHaveLength(0)
    expect((await call(reporter, 'POST', `/conversations/${conv}/messages`, { kind: 'text', body: 'hi' })).status).toBe(404)
    // And they cannot get back in by signing in again: the code verifies but no session is issued.
    await call(null, 'POST', '/auth/request-code', { email: 'tunde@st.futminna.edu.ng' })
    const code = devOutbox.filter((m) => m.to === 'tunde@st.futminna.edu.ng').at(-1)!.code
    const verify = await call(null, 'POST', '/auth/verify', { email: 'tunde@st.futminna.edu.ng', code })
    expect(verify.status).toBe(403)
    expect(verify.json.error).toBe('account_suspended')
    expect(verify.headers.get('set-cookie')).toBeNull()
  })

  test('a suspended student with a surviving session is rejected with account_suspended', async () => {
    const bad = await makeUser('Tunde')
    const { sessions: s } = await import('@moc/db')
    await A('POST', `/admin/users/${bad.id}/suspend`, { note: 'Fraudulent profile details' })
    // Simulate a session that outlived the suspension (e.g. created in a race)
    const sha = (x: string) => new Bun.CryptoHasher('sha256').update(x).digest('hex')
    await db.insert(s).values({ tokenHash: sha('late-token'), userId: bad.id, expiresAt: new Date(Date.now() + 3600_000) })
    const r = await call({ token: 'late-token' }, 'GET', '/me')
    expect(r.status).toBe(403)
    expect(r.json.error).toBe('account_suspended')
  })

  test('unsuspending restores visibility, and every step is in the moderation history and audit log', async () => {
    const bad = await makeUser('Tunde'), viewer = await makeUser('Amina')
    await A('POST', `/admin/users/${bad.id}/suspend`, { note: 'Fraudulent profile details' })
    expect((await call(viewer, 'GET', '/discover?intent=study')).json.cards).toHaveLength(0)
    await A('POST', `/admin/users/${bad.id}/unsuspend`, { note: 'Appeal accepted after review' })
    expect((await call(viewer, 'GET', '/discover?intent=study')).json.cards).toHaveLength(1)
    const detail = (await A('GET', `/admin/users/${bad.id}`)).json
    expect(detail.moderation.map((m: any) => m.action)).toEqual(['unsuspend', 'suspend'])
    const actions = (await db.select().from(adminAudit)).map((r) => r.action)
    expect(actions).toContain('user.suspend'); expect(actions).toContain('user.unsuspend')
  })

  test('resolving records who did it', async () => {
    const { rep } = await reportedScenario()
    await A('POST', `/admin/reports/${rep}/resolve`, { action: 'warn', note: 'Warned about tone in chats' })
    const [row] = await db.select().from(reports).where(eq(reports.id, rep))
    expect(row!.status).toBe('reviewed'); expect(row!.reviewedBy).toBeTruthy(); expect(row!.reviewedAt).toBeTruthy()
  })
})

describe('dashboard data', () => {
  test('overview counts students, modes, open reports, zero-filled daily series', async () => {
    await makeUser('Amina', { modes: ['study', 'friends'] }); await makeUser('Tunde', { modes: ['study'] })
    const reporter = await makeUser('Reporter'), target = await makeUser('Target')
    await call(reporter, 'POST', '/reports', { userId: target.id, reason: 'spam' })
    const o = (await A('GET', '/admin/overview?days=7')).json
    expect(o.totals.students).toBe(4)
    expect(o.totals.modes.study).toBeGreaterThanOrEqual(2)
    expect(o.totals.openReports).toBe(1)
    expect(o.series.signups).toHaveLength(7)
    expect(o.series.signups.reduce((s: number, d: any) => s + d.n, 0)).toBe(o.totals.students)
    expect(o.campuses[0].university).toBe('futminna')
  })

  test('validates query bounds', async () => {
    expect((await A('GET', '/admin/overview?days=1000')).status).toBe(422)
    expect((await A('GET', '/admin/users/not-a-uuid')).status).toBe(422)
  })

  test('health reports dependencies and request metrics', async () => {
    await call(null, 'GET', '/health')
    const h = (await A('GET', '/admin/health')).json
    expect(h.postgres.ok).toBe(true); expect(h.redis.ok).toBe(true)
    expect(h.requests.perMinute).toHaveLength(60)
  })

  test('searching and viewing users is audited; the feed shows signups', async () => {
    const u = await makeUser('Zainab')
    await A('GET', '/admin/users?q=Zain'); await A('GET', `/admin/users/${u.id}`)
    const actions = (await db.select().from(adminAudit)).map((r) => r.action)
    expect(actions).toContain('user.search'); expect(actions).toContain('user.view')
    expect(JSON.stringify((await A('GET', '/admin/activity')).json)).toContain('Zainab joined')
  })
})
