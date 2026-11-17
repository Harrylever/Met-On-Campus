import { Elysia, t } from 'elysia'
import { and, eq, inArray, or } from 'drizzle-orm'
import { connectionRequests, intentProfiles, NO_DEPARTMENT, users } from '@moc/db'
import { authed } from '../auth'
import { db } from '../context'
import * as presence from '../presence'
import { blockedWith } from '../blocks'
import { between } from '../requests'
import { approvedPhotoIds } from '../photos'

export const discoverRoutes = new Elysia({ prefix: '/discover' }).use(authed)
  .get('/', async ({ user, query, status }) => {
    const intent = query.intent
    const [mine] = await db.select().from(intentProfiles)
      .where(and(eq(intentProfiles.userId, user.id), eq(intentProfiles.intent, intent), eq(intentProfiles.enabled, true))).limit(1)
    if (!mine) return status(403, { error: 'mode_not_enabled' })

    const rows = await db.select({ u: users, p: intentProfiles }).from(intentProfiles)
      .innerJoin(users, eq(users.id, intentProfiles.userId))
      .where(and(eq(intentProfiles.intent, intent), eq(intentProfiles.enabled, true), eq(users.university, user.university)))
    const sent = await db.select().from(connectionRequests)
      .where(and(eq(connectionRequests.intent, intent), or(eq(connectionRequests.fromUserId, user.id), eq(connectionRequests.toUserId, user.id))))
    const blocked = await blockedWith(user.id)
    const hereNow = new Set(await presence.here(user.university))
    const photos = await approvedPhotoIds(rows.map(({ u }) => u.id), intent)

    const cards = rows
      .filter(({ u, p }) => {
        if (u.id === user.id || blocked.has(u.id)) return false
        // Someone you said "not now" to stays out of your feed.
        const r = between(sent, user.id, u.id)
        if (r?.status === 'declined' && r.toUserId === user.id) return false
        if (query.department && u.department !== query.department) return false
        if (query.level && u.level !== query.level) return false
        // Search: someone's name, what they wrote, or a tag (a course code, a club).
        const needle = query.q?.trim().toLowerCase()
        if (needle && ![u.name, p.prompt, p.bio, ...p.tags].some((x) => (x ?? '').toLowerCase().includes(needle))) return false
        const sameDept = user.department !== NO_DEPARTMENT && u.department === user.department
        return !(intent === 'romance' && sameDept && (p.hideFromDepartment || mine.hideFromDepartment))
      })
      .map(({ u, p }) => {
        const rel = between(sent, user.id, u.id)
        const tagsInCommon = p.tags.filter((tag) => mine.tags.includes(tag))
        return {
          userId: u.id, name: u.name, department: u.department, level: u.level, intent,
          prompt: p.prompt, bio: p.bio, tags: p.tags, usuallyFree: p.usuallyFree, usualSpot: p.usualSpot,
          inCommon: tagsInCommon, onCampusNow: hereNow.has(u.id),
          // Romance photos stay hidden until the Spark between you was accepted.
          photoId: (intent !== 'romance' || rel?.status === 'accepted') ? (photos.get(u.id) ?? null) : null,
          request: rel ? { id: rel.id, status: rel.status, direction: rel.fromUserId === user.id ? 'sent' : 'received' } : null,
        }
      })
      .sort((a, b) => Number(b.onCampusNow) - Number(a.onCampusNow) || b.inCommon.length - a.inCommon.length)
    // Counts cover everyone who matches; only the page being asked for is sent, so a big campus never arrives all at once.
    return { cards: cards.slice(0, query.limit ?? 24), total: cards.length, onCampusNow: cards.filter((c) => c.onCampusNow).length }
  }, { query: t.Object({
    intent: t.Union([t.Literal('study'), t.Literal('friends'), t.Literal('romance')]),
    department: t.Optional(t.String()), level: t.Optional(t.Numeric()),
    q: t.Optional(t.String({ maxLength: 60 })), limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  }) })
