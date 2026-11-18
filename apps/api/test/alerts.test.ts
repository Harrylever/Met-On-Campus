import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { blocks, connectionRequests, conversationReads, conversations, messages, roomMembers, rooms, users } from '@moc/db'
import { COOLDOWN_H, runAlerts } from '../src/alerts'
import { db } from '../src/context'
import { devMail } from '../src/email'
import * as presence from '../src/presence'
import { orderedPair } from '../src/visibility'
import { call, makeUser, resetAll, type Intent } from './helpers'

beforeEach(async () => { await resetAll(); devMail.length = 0 })
type U = { id: string; email: string; university: string }
const NOW = new Date()
const ago = (min: number) => new Date(+NOW - min * 60_000)
const OLD = 30 // minutes: past the grace period

/** Run a pass at `now`, capturing what would be sent. */
async function pass(now = NOW) {
  const sent: { to: string; w: { invites: number; chats: number; rooms: number } }[] = []
  const r = await runAlerts({ now, lock: false, send: async (to, w) => { sent.push({ to, w }) } })
  return { sent, skipped: r.skipped }
}
const invite = (from: U, to: U, intent: Intent = 'study', createdAt = ago(OLD), status: 'pending' | 'accepted' | 'declined' = 'pending') =>
  db.insert(connectionRequests).values({ intent, fromUserId: from.id, toUserId: to.id, status, createdAt }).returning().then((r) => r[0]!)
async function chat(a: U, b: U, intent: Intent = 'study') {
  const [x, y] = orderedPair(a.id, b.id)
  return (await db.insert(conversations).values({ intent, userAId: x, userBId: y }).returning())[0]!
}
const say = (conv: string, from: U, createdAt = ago(OLD)) => db.insert(messages).values({ conversationId: conv, senderId: from.id, kind: 'text', body: 'hi', createdAt })
const room = async (host: U, endsInMin = 120) => (await db.insert(rooms).values({ intent: 'study', hostId: host.id, university: 'futminna', tag: 'X', title: 'T', place: 'Library', startsAt: ago(5), endsAt: new Date(+NOW + endsInMin * 60_000), capacity: 5 }).returning())[0]!

describe('who gets an alert', () => {
  test('an invite that has waited past the grace period', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await invite(a, b)
    const r = await pass()
    expect(r.sent).toEqual([{ to: b.email, w: { invites: 1, chats: 0, rooms: 0 } }]) // the person invited, not the sender
  })

  test('nothing before the grace period, nor for stale news', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U, c = await makeUser('Chidi') as U
    await invite(a, b, 'study', ago(7))                 // seven minutes old: they may be looking at it right now
    await invite(a, c, 'study', ago(25 * 60))           // a day old: stale
    expect((await pass()).sent).toHaveLength(0)
  })

  test('nobody who is in the app right now', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await invite(a, b); await presence.beat('futminna', b.id)
    expect((await pass()).sent).toHaveLength(0)
  })

  test('not for people who turned alerts off, are suspended, or never verified', async () => {
    const a = await makeUser('Amina') as U
    const off = await makeUser('Off') as U, sus = await makeUser('Sus') as U, unv = await makeUser('Unv') as U
    await db.update(users).set({ emailAlerts: false }).where(eq(users.id, off.id))
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, sus.id))
    await db.update(users).set({ verifiedAt: null }).where(eq(users.id, unv.id))
    for (const u of [off, sus, unv]) await invite(a, u)
    expect((await pass()).sent).toHaveLength(0)
  })

  test('never because of a blocked pair, a declined invite, or a suspended sender', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U, c = await makeUser('Chidi') as U, d = await makeUser('Dami') as U
    await invite(a, b); await db.insert(blocks).values({ blockerId: b.id, blockedId: a.id })   // blocked
    await invite(a, c, 'study', ago(OLD), 'declined')                                          // declined
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, a.id)); await invite(a, d) // sender suspended
    expect((await pass()).sent).toHaveLength(0)
  })
})

describe('how often', () => {
  test('one email per person per stretch of news: the cooldown, and never the same news twice', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U, c = await makeUser('Chidi') as U
    await invite(a, b)
    expect((await pass()).sent).toHaveLength(1)
    expect((await pass()).sent).toHaveLength(0)                                                  // right away: nothing new, cooldown
    await invite(c, b, 'study', ago(OLD - 1))                                                    // more news...
    expect((await pass()).sent).toHaveLength(0)                                                  // ...but inside the cooldown
    const later = new Date(+NOW + (COOLDOWN_H + 1) * 3_600_000)
    const r = await pass(later)                                                                  // after the cooldown, the news is different
    expect(r.sent).toHaveLength(1); expect(r.sent[0]!.w.invites).toBe(2)
    expect((await pass(new Date(+later + (COOLDOWN_H + 1) * 3_600_000))).sent).toHaveLength(0)   // and the same again is not repeated
  })

  test('a failed send is not counted: it is tried again on the next pass', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await invite(a, b)
    const failed = await runAlerts({ now: NOW, lock: false, send: async () => { throw new Error('provider down') } })
    expect(failed.sent).toBe(0)
    expect((await pass()).sent).toHaveLength(1)
  })

  test('two passes at once cannot both send (one instance at a time)', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await invite(a, b)
    const sent: string[] = []
    const send = async (to: string) => { sent.push(to); await new Promise((r) => setTimeout(r, 30)) }
    await Promise.all([runAlerts({ now: NOW, send }), runAlerts({ now: NOW, send })])
    expect(sent).toHaveLength(1)
  })
})

describe('what counts as waiting', () => {
  test('an unread chat counts once however many messages, and clears when read', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await invite(a, b, 'study', ago(OLD + 5), 'accepted')
    const c = await chat(a, b)
    await say(c.id, a, ago(OLD)); await say(c.id, a, ago(OLD + 1)); await say(c.id, a, ago(OLD + 2))
    const r = await pass()
    expect(r.sent).toEqual([{ to: b.email, w: { invites: 0, chats: 1, rooms: 0 } }])
    // a different person who already opened the chat after those messages has nothing waiting
    await db.insert(conversationReads).values({ conversationId: c.id, userId: b.id, readAt: ago(5) })
    expect((await pass(new Date(+NOW + 7 * 3_600_000))).sent).toHaveLength(0)
  })

  test('the intro message of an invite is the invite, not also a chat', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await invite(a, b); const c = await chat(a, b); await say(c.id, a)
    expect((await pass()).sent[0]!.w).toEqual({ invites: 1, chats: 0, rooms: 0 })
  })

  test('your own messages never count for you, and a closed conversation never counts', async () => {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde') as U
    await invite(a, b, 'study', ago(OLD), 'declined'); const c = await chat(a, b)
    await say(c.id, a); await say(c.id, b)
    expect((await pass()).sent).toHaveLength(0)
  })

  test('rooms: people waiting for a host, answers a member has not seen, cancellations; not ended rooms, not seen news', async () => {
    const host = await makeUser('Host') as U, ada = await makeUser('Ada') as U, bayo = await makeUser('Bayo') as U, old = await makeUser('Old') as U
    const r1 = await room(host)
    await db.insert(roomMembers).values({ roomId: r1.id, userId: host.id, status: 'approved', decisionSeenAt: NOW })
    await db.insert(roomMembers).values({ roomId: r1.id, userId: ada.id, status: 'pending', createdAt: ago(OLD) })       // waiting for the host
    await db.insert(roomMembers).values({ roomId: r1.id, userId: bayo.id, status: 'approved', createdAt: ago(OLD) })     // answered, unseen
    const gone = await room(host, -5)                                                                                    // already over
    await db.insert(roomMembers).values({ roomId: gone.id, userId: old.id, status: 'approved', createdAt: ago(OLD) })
    const sent = (await pass()).sent
    expect(sent.find((s) => s.to === host.email)!.w.rooms).toBe(1)
    expect(sent.find((s) => s.to === bayo.email)!.w.rooms).toBe(1)
    expect(sent.find((s) => s.to === ada.email)).toBeUndefined()   // still waiting is not news for the one waiting
    expect(sent.find((s) => s.to === old.email)).toBeUndefined()
    await db.update(roomMembers).set({ decisionSeenAt: NOW }).where(eq(roomMembers.userId, bayo.id))
    expect((await pass(new Date(+NOW + 7 * 3_600_000))).sent.find((s) => s.to === bayo.email)).toBeUndefined()
  })
})

describe('the email itself', () => {
  async function waitingEmail() {
    const a = await makeUser('Amina') as U, b = await makeUser('Tunde', { modes: ['romance'] }) as U
    await invite(a, b, 'romance'); await invite(a, b, 'study')
    await runAlerts({ now: NOW, lock: false })           // the real sender: dev mode keeps it in devMail
    const [token] = await db.select({ t: users.unsubscribeToken }).from(users).where(eq(users.id, b.id))
    return { mail: devMail.at(-1)!, token: token!.t, a, b }
  }

  test('is generic: counts only, with no name and no mode, in subject, text and HTML', async () => {
    const { mail } = await waitingEmail()
    expect(mail.subject).toBe('You have 1 thing waiting on Met On Campus'.replace('1 thing', '2 things').replace('thing waiting', 'things waiting'))
    for (const part of [mail.subject, mail.text, mail.html]) {
      expect(part).not.toMatch(/amina|tunde/i)
      expect(part).not.toMatch(/romance|spark|friends|study/i)
    }
    expect(mail.text).toContain('2 new invites')
  })

  test('has a working one-click unsubscribe, in the headers and in the footer', async () => {
    const { mail, token } = await waitingEmail()
    const url = `http://localhost:3001/unsubscribe/${token}`
    expect(mail.headers['List-Unsubscribe']).toBe(`<${url}>`)
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(mail.html).toContain(url); expect(mail.text).toContain(url)
  })

  test('uses the layout: preheader, brand, dark mode, an open-app button', async () => {
    const { mail } = await waitingEmail()
    expect(mail.html).toContain('Open the app to see what is waiting')       // preheader
    expect(mail.html).toContain('prefers-color-scheme: dark')
    expect(mail.html).toContain('Open Met On Campus')
    expect(mail.html).toContain('http://localhost:3000')                      // the app link
  })
})
