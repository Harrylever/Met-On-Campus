import { Elysia, t } from 'elysia'
import { and, eq, inArray, or } from 'drizzle-orm'
import { connectionRequests, intentProfiles, NO_DEPARTMENT, users } from '@moc/db'
import { authed } from '../auth'
import { db } from '../context'
import * as presence from '../presence'
import { blockedWith } from '../blocks'

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

    const cards = rows
      .filter(({ u, p }) => {
        if (u.id === user.id || blocked.has(u.id)) return false
        if (query.department && u.department !== query.department) return false
        if (query.level && u.level !== query.level) return false
        const sameDept = user.department !== NO_DEPARTMENT && u.department === user.department
        return !(intent === 'romance' && sameDept && (p.hideFromDepartment || mine.hideFromDepartment))
      })
      .map(({ u, p }) => {
        const rel = sent.find((r) => (r.fromUserId === user.id && r.toUserId === u.id) || (r.fromUserId === u.id && r.toUserId === user.id))
        const tagsInCommon = p.tags.filter((tag) => mine.tags.includes(tag))
        return {
          userId: u.id, name: u.name, department: u.department, level: u.level, intent,
          prompt: p.prompt, bio: p.bio, tags: p.tags, usuallyFree: p.usuallyFree, usualSpot: p.usualSpot,
          inCommon: tagsInCommon, onCampusNow: hereNow.has(u.id),
          request: rel ? { id: rel.id, status: rel.status, direction: rel.fromUserId === user.id ? 'sent' : 'received' } : null,
        }
      })
      .sort((a, b) => Number(b.onCampusNow) - Number(a.onCampusNow) || b.inCommon.length - a.inCommon.length)
    return { cards, onCampusNow: cards.filter((c) => c.onCampusNow).length }
  }, { query: t.Object({ intent: t.Union([t.Literal('study'), t.Literal('friends'), t.Literal('romance')]), department: t.Optional(t.String()), level: t.Optional(t.Numeric()) }) })
