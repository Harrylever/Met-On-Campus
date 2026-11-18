import { Elysia, t } from 'elysia'
import { and, eq, isNotNull, notInArray, sql } from 'drizzle-orm'
import { campusInterest, campuses, campusSpots, departments, users } from '@moc/db'
import { db } from '../context'
import { openCampus, validSlug } from '../campuses'
import { tidy, validListName } from '../lists'
import { adminAuthed, audit } from './session'

// Which universities can create accounts. Opening a campus can start it from the template department and spot lists; pausing
// stops new accounts only. "Asked to join" is a count of attempts from universities that are not open yet (no emails kept).
export const adminCampuses = new Elysia({ prefix: '/admin/campuses' }).use(adminAuthed)
  .get('/', async () => {
    const rows = await db.select().from(campuses).orderBy(campuses.name)
    const students = await db.select({ u: users.university, n: sql<number>`count(*)::int` }).from(users).groupBy(users.university)
    const depts = await db.select({ u: departments.university, n: sql<number>`count(*)::int` }).from(departments).where(and(isNotNull(departments.university), eq(departments.active, true))).groupBy(departments.university)
    const spots = await db.select({ u: campusSpots.university, n: sql<number>`count(*)::int` }).from(campusSpots).where(and(isNotNull(campusSpots.university), eq(campusSpots.active, true))).groupBy(campusSpots.university)
    const by = (list: { u: string | null; n: number }[], slug: string) => list.find((x) => x.u === slug)?.n ?? 0
    const asked = await db.select().from(campusInterest)
      .where(rows.length ? notInArray(campusInterest.slug, rows.map((r) => r.slug)) : undefined)
      .orderBy(sql`${campusInterest.attempts} desc`).limit(50)
    return {
      campuses: rows.map((c) => ({ slug: c.slug, name: c.name, open: c.open, students: by(students, c.slug), departments: by(depts, c.slug), spots: by(spots, c.slug), createdAt: c.createdAt })),
      asked: asked.map((a) => ({ slug: a.slug, attempts: a.attempts, lastAt: a.lastAt })),
    }
  })

  .post('/', async ({ admin, body, ip, status }) => {
    const slug = body.slug.trim().toLowerCase(), name = tidy(body.name)
    if (!validSlug(slug)) return status(422, { error: 'invalid_slug' })
    if (!validListName(name)) return status(422, { error: 'invalid_name' })
    if (!(await openCampus(slug, name, body.fromTemplate ?? true))) return status(409, { error: 'exists' })
    await audit(admin.id, 'campus.open', { targetType: 'campus', targetId: slug, meta: { name, fromTemplate: body.fromTemplate ?? true }, ip })
    return { ok: true }
  }, { body: t.Object({ slug: t.String({ maxLength: 60 }), name: t.String({ maxLength: 120 }), fromTemplate: t.Optional(t.Boolean()) }) })

  // Rename, pause or resume. Pausing stops new accounts only; students already in carry on.
  .patch('/:slug', async ({ admin, params, body, ip, status }) => {
    const [row] = await db.select().from(campuses).where(eq(campuses.slug, params.slug)).limit(1)
    if (!row) return status(404, { error: 'not_found' })
    const name = body.name !== undefined ? tidy(body.name) : row.name
    if (body.name !== undefined && !validListName(name)) return status(422, { error: 'invalid_name' })
    await db.update(campuses).set({ name, ...(body.open !== undefined ? { open: body.open } : {}) }).where(eq(campuses.slug, row.slug))
    if (name !== row.name) await audit(admin.id, 'campus.rename', { targetType: 'campus', targetId: row.slug, meta: { from: row.name, to: name }, ip })
    if (body.open !== undefined && body.open !== row.open) await audit(admin.id, body.open ? 'campus.resume' : 'campus.pause', { targetType: 'campus', targetId: row.slug, meta: { name }, ip })
    return { ok: true }
  }, { params: t.Object({ slug: t.String({ maxLength: 60 }) }), body: t.Object({ name: t.Optional(t.String({ maxLength: 120 })), open: t.Optional(t.Boolean()) }) })
