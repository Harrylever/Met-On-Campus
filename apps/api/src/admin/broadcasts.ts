import { Elysia, t } from 'elysia'
import { and, desc, eq, getTableColumns, isNotNull } from 'drizzle-orm'
import { adminUsers, campuses, departments, pushBroadcasts } from '@moc/db'
import { db, redis } from '../context'
import { audienceCounts, broadcastPush, inBackground, pushEnabled, type Audience } from '../push'
import { hit } from '../ratelimit'
import { adminAuthed, audit } from './session'

export const MAX_TITLE = 50
export const MAX_BODY = 140
const PER_HOUR = 5
const DUPLICATE_WINDOW_SEC = 600
// A path inside the app only: starts with one slash (not "//" or "/\"), no spaces, no scheme.
const LINK = /^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/

type Audit = { university?: string; department?: string }
/** The campus must exist, and a department only means something inside one campus. Returns an error code or the audience. */
async function checkAudience(b: Audit): Promise<{ error: string } | { audience: Audience }> {
  const university = b.university || null, department = b.department || null
  if (department && !university) return { error: 'department_needs_campus' }
  if (university) {
    const [c] = await db.select({ slug: campuses.slug }).from(campuses).where(eq(campuses.slug, university)).limit(1)
    if (!c) return { error: 'unknown_campus' }
  }
  return { audience: { university, department } }
}

/** Announcements staff send to students who have push turned on. History lives in push_broadcasts. */
export const adminBroadcasts = new Elysia({ prefix: '/admin/broadcasts' }).use(adminAuthed)
  .get('/', async () => {
    // Left join: the sender's id has no foreign key, so the history survives a deleted staff account.
    const items = await db.select({ ...getTableColumns(pushBroadcasts), admin: adminUsers.email }).from(pushBroadcasts)
      .leftJoin(adminUsers, eq(adminUsers.id, pushBroadcasts.adminId)).orderBy(desc(pushBroadcasts.createdAt)).limit(30)
    const campusList = await db.select({ slug: campuses.slug, name: campuses.name }).from(campuses).orderBy(campuses.name)
    const depts = await db.select({ name: departments.name, university: departments.university }).from(departments)
      .where(and(eq(departments.active, true), isNotNull(departments.university))).orderBy(departments.sortOrder, departments.name)
    return { items, campuses: campusList, departments: depts }
  })

  .post('/preview', async ({ body, status }) => {
    const a = await checkAudience(body)
    if ('error' in a) return status(422, { error: a.error })
    return audienceCounts(a.audience)
  }, { body: t.Object({ university: t.Optional(t.String({ maxLength: 60 })), department: t.Optional(t.String({ maxLength: 120 })) }) })

  .post('/', async ({ admin, body, ip, status }) => {
    if (!pushEnabled) return status(503, { error: 'push_unavailable' })
    const title = body.title.trim(), text = body.body.trim(), url = body.url?.trim() || '/discover'
    if (!title || title.length > MAX_TITLE) return status(422, { error: 'invalid_title' })
    if (!text || text.length > MAX_BODY) return status(422, { error: 'invalid_body' })
    if (!LINK.test(url) || url.length > 200) return status(422, { error: 'invalid_link' })
    const a = await checkAudience(body)
    if ('error' in a) return status(422, { error: a.error })

    // A double click or a retried request must not notify everyone twice. The key is released if the send does not happen.
    const dupKey = `bc:dup:${new Bun.CryptoHasher('sha256').update(JSON.stringify([title, text, url, a.audience.university, a.audience.department])).digest('hex')}`
    if (!(await redis.set(dupKey, '1', 'EX', DUPLICATE_WINDOW_SEC, 'NX'))) return status(409, { error: 'duplicate_broadcast' })
    if (await hit('broadcast', PER_HOUR, 3600)) { await redis.del(dupKey); return status(429, { error: 'too_many_broadcasts' }) }
    const reach = await audienceCounts(a.audience)
    if (reach.devices === 0) { await redis.del(dupKey); return status(422, { error: 'no_recipients' }) }

    // Recorded first, then sent in the background: a large audience takes longer than a request may, and a failure part-way
    // must never leave students notified with no record of who sent it.
    const [row] = await db.insert(pushBroadcasts).values({ adminId: admin.id, title, body: text, url, ...a.audience, students: reach.students, devices: reach.devices }).returning({ id: pushBroadcasts.id })
    await audit(admin.id, 'push.broadcast', { targetType: 'push_broadcast', targetId: row!.id, meta: { title, ...a.audience, students: reach.students, devices: reach.devices }, ip })
    inBackground(broadcastPush(a.audience, { title, body: text, url }).then((out) => db.update(pushBroadcasts).set(out).where(eq(pushBroadcasts.id, row!.id))))
    return { id: row!.id, students: reach.students, devices: reach.devices }
  }, { body: t.Object({
    title: t.String({ maxLength: 500 }), body: t.String({ maxLength: 2000 }), url: t.Optional(t.String({ maxLength: 500 })),
    university: t.Optional(t.String({ maxLength: 60 })), department: t.Optional(t.String({ maxLength: 120 })),
  }) })
