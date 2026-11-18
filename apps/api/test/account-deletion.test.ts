import { beforeEach, describe, expect, test } from 'bun:test'
import { eq, or } from 'drizzle-orm'
import { adminAudit, blocks, connectionRequests, conversations, emailCodes, intentProfiles, messages, moderationActions, profilePhotos, reports, roomMembers, rooms, sessions, users } from '@moc/db'
import { db, redis } from '../src/context'
import { devOutbox } from '../src/email'
import * as presence from '../src/presence'
import { store } from '../src/storage'
import { adminCall, adminLogin, call, makeAdmin, makeUser, resetAll } from './helpers'

beforeEach(resetAll)
type U = { id: string; token: string; email: string; name: string }
const asking = async (u: U) => { const r = await call(u, 'POST', '/me/delete/code'); return { r, code: devOutbox.filter((m) => m.to === u.email).at(-1)?.code ?? '' } }
const del = (u: U, code: string, confirm: string = 'DELETE') => call(u, 'POST', '/me/delete', { code, confirm })
const count = async (table: any, cond: any) => (await db.select().from(table).where(cond)).length

/** An account with something in every place data can live. */
async function richAccount() {
  const me = await makeUser('Amina', { modes: ['study', 'friends'] }) as unknown as U
  const pal = await makeUser('Tunde', { modes: ['study', 'friends'] }) as unknown as U
  const third = await makeUser('Chidi', { modes: ['study'] }) as unknown as U
  // chats + a request + a block
  const conv = (await call(me, 'POST', '/connections', { toUserId: pal.id, intent: 'study' })).json
  await call(pal, 'PATCH', `/connections/${conv.requestId}`, { status: 'accepted' })
  await call(me, 'POST', `/conversations/${conv.conversationId}/messages`, { kind: 'text', body: 'hello' })
  await call(pal, 'POST', `/conversations/${conv.conversationId}/messages`, { kind: 'text', body: 'hi back' })
  await call(me, 'POST', '/blocks', { userId: third.id })
  // a photo, with a real file
  const key = `photos/${me.id}/test.webp`
  await store.put(key, new Uint8Array([1, 2, 3]))
  await db.insert(profilePhotos).values({ userId: me.id, intent: 'study', storageKey: key, status: 'approved' })
  // a room they host with a member, and a room someone else hosts that they joined
  const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
  const mine = (await call(me, 'POST', '/rooms', { intent: 'study', tag: 'CSS', title: 'Mine', place: 'University Library', startsAt: new Date().toISOString(), endsAt: future(2), capacity: 4 })).json.room.id
  await call(pal, 'POST', `/rooms/${mine}/request`); await call(me, 'POST', `/rooms/${mine}/requests/${pal.id}`, { decision: 'approved' })
  const theirs = (await call(pal, 'POST', '/rooms', { intent: 'study', tag: 'CPT', title: 'Theirs', place: 'ICT Centre', startsAt: new Date().toISOString(), endsAt: future(2), capacity: 4 })).json.room.id
  await call(me, 'POST', `/rooms/${theirs}/request`)
  await presence.beat('futminna', me.id)
  await db.insert(emailCodes).values({ email: me.email, codeHash: 'x', expiresAt: new Date(Date.now() + 60_000), attempts: 0 })
  return { me, pal, third, conv: conv.conversationId as string, key, mine, theirs }
}

describe('asking to delete: the guards', () => {
  test('needs a sign-in; a code goes to their own email, one a minute', async () => {
    expect((await call(null, 'POST', '/me/delete/code')).status).toBe(401)
    expect((await call(null, 'POST', '/me/delete', { code: '123456', confirm: 'DELETE' })).status).toBe(401)
    const me = await makeUser('Amina') as unknown as U
    const first = await asking(me)
    expect(first.r.status).toBe(200); expect(first.code).toMatch(/^\d{6}$/)
    const again = await call(me, 'POST', '/me/delete/code')
    expect(again.status).toBe(429); expect(again.json.retryAfter).toBeGreaterThan(0)
  })

  test('nothing is deleted without the exact word, a six-digit code, and the right code', async () => {
    const me = await makeUser('Amina') as unknown as U
    const { code } = await asking(me)
    expect((await del(me, code, 'delete')).status).toBe(422)       // not the exact word
    expect((await del(me, code, '')).status).toBe(422)
    expect((await del(me, '12345')).status).toBe(422)              // not six digits
    const wrong = code === '000000' ? '111111' : '000000'
    expect((await del(me, wrong)).json.error).toBe('code_invalid')
    expect(await count(users, eq(users.id, me.id))).toBe(1)        // still here
  })

  test('without a code requested, or after it expired, it is refused', async () => {
    const me = await makeUser('Amina') as unknown as U
    expect((await del(me, '123456')).json.error).toBe('code_expired')
    const { code } = await asking(me); await redis.del(`delcode:${me.id}`)
    expect((await del(me, code)).json.error).toBe('code_expired')
  })

  test('five wrong tries use the code up; the right code no longer works', async () => {
    const me = await makeUser('Amina') as unknown as U
    const { code } = await asking(me); const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) expect((await del(me, wrong)).json.error).toBe('code_invalid')
    expect((await del(me, wrong)).json.error).toBe('too_many_attempts')
    expect((await del(me, code)).status).toBe(429)
    expect(await count(users, eq(users.id, me.id))).toBe(1)
  })

  test("one student's code does not delete another student's account", async () => {
    const a = await makeUser('Amina') as unknown as U, b = await makeUser('Tunde') as unknown as U
    const { code } = await asking(a)
    await asking(b)
    expect((await del(b, code)).json.error).toBe('code_invalid')
    expect(await count(users, eq(users.id, b.id))).toBe(1)
  })
})

describe('what deleting removes', () => {
  test('everything that is theirs is gone, including the photo file and their live state', async () => {
    const { me, conv, key, mine } = await richAccount()
    const { code } = await asking(me)
    expect((await del(me, code)).status).toBe(200)

    expect(await count(users, eq(users.id, me.id))).toBe(0)
    expect((await call(me, 'GET', '/me')).status).toBe(401)                                    // the session is gone
    expect(await count(sessions, eq(sessions.userId, me.id))).toBe(0)
    expect(await count(intentProfiles, eq(intentProfiles.userId, me.id))).toBe(0)
    expect(await count(profilePhotos, eq(profilePhotos.userId, me.id))).toBe(0)
    expect(await store.get(key)).toBeNull()                                                    // the file, not just the row
    expect(await count(conversations, eq(conversations.id, conv))).toBe(0)
    expect(await count(messages, eq(messages.conversationId, conv))).toBe(0)                   // both sides of that chat
    expect(await count(connectionRequests, or(eq(connectionRequests.fromUserId, me.id), eq(connectionRequests.toUserId, me.id)))).toBe(0)
    expect(await count(blocks, eq(blocks.blockerId, me.id))).toBe(0)
    expect(await count(rooms, eq(rooms.id, mine))).toBe(0)                                     // a room they hosted
    expect(await count(roomMembers, eq(roomMembers.userId, me.id))).toBe(0)                    // places they held elsewhere
    expect(await count(emailCodes, eq(emailCodes.email, me.email))).toBe(0)
    expect(await presence.here('futminna')).not.toContain(me.id)
  })

  test('other people are untouched, and their own data stays', async () => {
    const { me, pal, third, theirs } = await richAccount()
    const palConv = (await call(pal, 'POST', '/connections', { toUserId: third.id, intent: 'study' })).json.conversationId
    await call(pal, 'POST', `/conversations/${palConv}/messages`, { kind: 'text', body: 'unrelated chat' })
    const { code } = await asking(me); await del(me, code)
    expect(await count(users, eq(users.id, pal.id))).toBe(1); expect(await count(users, eq(users.id, third.id))).toBe(1)
    expect(await count(messages, eq(messages.conversationId, palConv))).toBe(1)
    expect(await count(rooms, eq(rooms.id, theirs))).toBe(1)                                    // their room just loses a hopeful member
    expect((await call(pal, 'GET', '/conversations?intent=study')).json.conversations.map((c: { id: string }) => c.id)).toEqual([palConv])
  })

  test('they can sign up again afterwards as a brand-new account', async () => {
    const { me } = await richAccount()
    const { code } = await asking(me); await del(me, code)
    const again = await call(null, 'POST', '/auth/request-code', { email: me.email })
    expect(again.status).toBe(200)
    const signIn = devOutbox.filter((m) => m.to === me.email).at(-1)!.code
    const v = await call(null, 'POST', '/auth/verify', { email: me.email, code: signIn })
    expect(v.status).toBe(200); expect(v.json.onboarded).toBe(false)                              // nothing carried over
  })
})

describe('what deleting keeps', () => {
  async function withReports() {
    const a = await richAccount()
    const bystander = await makeUser('Bayo') as unknown as U
    // a report about them, with a saved message; and a report they made about someone else; and a moderation action
    const aboutThem = (await call(bystander, 'POST', '/reports', { userId: a.me.id, reason: 'harassment', details: 'rude', intent: 'study' })).json.reportId
    const byThem = (await call(a.me, 'POST', '/reports', { userId: a.third.id, reason: 'spam', details: 'ads', intent: 'study' })).json.reportId
    const [rep] = await db.select().from(reports).where(eq(reports.reporterId, bystander.id))
    await db.insert(moderationActions).values({ adminId: crypto.randomUUID(), userId: a.me.id, reportId: rep!.id, action: 'warn', note: 'warned' })
    return { ...a, bystander, aboutThem, byThem }
  }

  test('reports about them and by them survive, with the account link cleared and only a name and campus kept', async () => {
    const { me, third, bystander } = await withReports()
    const { code } = await asking(me); await del(me, code)
    const about = (await db.select().from(reports).where(eq(reports.reporterId, bystander.id)))[0]!
    expect(about).toMatchObject({ reportedId: null, reportedLabel: 'Amina, futminna', reason: 'harassment' })
    const byThem = (await db.select().from(reports).where(eq(reports.reportedId, third.id)))[0]!
    expect(byThem).toMatchObject({ reporterId: null, reason: 'spam' })
    expect((await db.select().from(moderationActions))[0]).toMatchObject({ userId: null, action: 'warn' })
  })

  test('staff still see those reports, marked as deleted accounts, and can close them', async () => {
    const { me, bystander } = await withReports()
    const S = await adminLogin(await makeAdmin())
    const { code } = await asking(me); await del(me, code)
    const list = (await adminCall('GET', '/admin/reports', undefined, { session: S })).json.reports as any[]
    const r = list.find((x) => x.reportedDeleted)!
    expect(r).toMatchObject({ reported: null, reportedLabel: 'Amina, futminna', reportedDeleted: true })
    expect(r.reporter.name).toBe('Bayo')
    const closed = await adminCall('POST', `/admin/reports/${r.id}/resolve`, { action: 'suspend', note: 'for the record' }, { session: S })
    expect(closed.status).toBe(200)                                                              // nobody left to suspend, still closed
    expect((await db.select().from(reports).where(eq(reports.reporterId, bystander.id)))[0]!.status).toBe('reviewed')
  })

  test('the audit log records that it happened, with the account id and campus but never the email or name', async () => {
    const { me } = await richAccount()
    const { code } = await asking(me); await del(me, code)
    const [entry] = (await db.select().from(adminAudit)).filter((a) => a.action === 'account.self_delete')
    expect(entry).toMatchObject({ adminId: null, targetType: 'user', targetId: me.id })
    expect(entry!.meta).toContain('futminna')
    expect(JSON.stringify(entry)).not.toContain(me.email); expect(JSON.stringify(entry)).not.toContain('Amina')
  })
})

describe('staff deleting an account on request', () => {
  test('needs a staff session; the typed email must match; a written reason is required', async () => {
    const u = await makeUser('Amina') as unknown as U
    expect((await adminCall('POST', `/admin/users/${u.id}/delete`, { confirmEmail: u.email, reason: 'asked by email' })).status).toBe(401)
    const S = await adminLogin(await makeAdmin())
    const A = (body: unknown, id = u.id) => adminCall('POST', `/admin/users/${id}/delete`, body, { session: S })
    expect((await A({ confirmEmail: 'someone.else@st.futminna.edu.ng', reason: 'asked by email' })).json.error).toBe('confirm_mismatch')
    expect((await A({ confirmEmail: u.email, reason: 'no' })).json.error).toBe('reason_required')
    expect((await A({ confirmEmail: u.email, reason: 'asked by email' }, crypto.randomUUID())).status).toBe(404)
    expect(await count(users, eq(users.id, u.id))).toBe(1)
  })

  test('deletes everything, and audits who did it and why', async () => {
    const { me, key } = await richAccount()
    const admin = await makeAdmin(); const S = await adminLogin(admin)
    const r = await adminCall('POST', `/admin/users/${me.id}/delete`, { confirmEmail: me.email.toUpperCase(), reason: 'Requested by email on 17 Nov' }, { session: S })
    expect(r.status).toBe(200)
    expect(await count(users, eq(users.id, me.id))).toBe(0); expect(await store.get(key)).toBeNull()
    const [entry] = (await db.select().from(adminAudit)).filter((a) => a.action === 'user.delete')
    expect(entry).toMatchObject({ adminId: admin.id, targetId: me.id }); expect(entry!.meta).toContain('Requested by email')
    expect(JSON.stringify(entry)).not.toContain(me.email)
  })
})
