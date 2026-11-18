import { Elysia, t } from 'elysia'
import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import { departmentRequests, departments, NO_DEPARTMENT, users } from '@moc/db'
import { bus, db, topics } from '../context'
import { tidy, validListName } from '../lists'
import { adminAuthed, audit } from './session'

const key = (university: string, name: string) => `${university}\u0000${name.toLowerCase()}`

/**
 * Requests from students whose department is not listed. Pending requests for the same name on the same campus are
 * shown (and resolved) together, so staff decide once however many students asked.
 */
export const adminDepartmentRequests = new Elysia({ prefix: '/admin/department-requests' }).use(adminAuthed)
  .get('/', async () => {
    const pendingRows = await db.select().from(departmentRequests).where(eq(departmentRequests.status, 'pending')).orderBy(departmentRequests.createdAt)
    const groups = new Map<string, { requestId: string; name: string; university: string; students: number; firstRequestedAt: Date; spellings: string[] }>()
    for (const r of pendingRows) {
      const g = groups.get(key(r.university, r.name))
      if (g) { g.students++; if (!g.spellings.includes(r.name)) g.spellings.push(r.name) }
      else groups.set(key(r.university, r.name), { requestId: r.id, name: r.name, university: r.university, students: 1, firstRequestedAt: r.createdAt, spellings: [r.name] })
    }
    const resolved = await db.select().from(departmentRequests).where(inArray(departmentRequests.status, ['approved', 'declined'])).orderBy(desc(departmentRequests.reviewedAt)).limit(80)
    const recent = new Map<string, { name: string; university: string; status: string; resolvedName: string | null; note: string | null; reviewedAt: Date | null; students: number }>()
    for (const r of resolved) {
      const k = `${key(r.university, r.name)}|${r.status}|${r.reviewedAt?.toISOString()}`
      const g = recent.get(k)
      if (g) g.students++
      else if (recent.size < 15) recent.set(k, { name: r.name, university: r.university, status: r.status, resolvedName: r.resolvedName, note: r.note, reviewedAt: r.reviewedAt, students: 1 })
    }
    // Existing departments staff can map a request onto ("Cyber Sec" -> "Cyber Security").
    // Departments staff can map a request onto: each campus's own list (the template is not offered).
    const existing = await db.select({ id: departments.id, name: departments.name, university: departments.university }).from(departments).where(and(eq(departments.active, true), isNotNull(departments.university))).orderBy(departments.sortOrder, departments.name)
    return { pending: [...groups.values()], recent: [...recent.values()], departments: existing }
  })

  // Decide a request. Every pending request for the same name on that campus gets the same outcome.
  .post('/resolve', async ({ admin, body, ip, status }) => {
    const [req] = await db.select().from(departmentRequests).where(eq(departmentRequests.id, body.requestId)).limit(1)
    if (!req) return status(404, { error: 'not_found' })
    if (req.status !== 'pending') return status(409, { error: 'already_resolved' })

    const out = await db.transaction(async (tx) => {
      const group = await tx.select().from(departmentRequests).where(and(
        eq(departmentRequests.status, 'pending'), eq(departmentRequests.university, req.university), sql`lower(${departmentRequests.name}) = ${req.name.toLowerCase()}`,
      )).for('update')
      if (group.length === 0) return { code: 409 as const, error: 'already_resolved' }

      let resolvedName: string | null = null
      if (body.action === 'approve') {
        const name = tidy(body.name ?? req.name)
        if (!validListName(name)) return { code: 422 as const, error: 'invalid_name' }
        // If this campus already has a department with this name, point staff at "use existing" instead.
        const [clash] = await tx.select({ id: departments.id }).from(departments).where(and(sql`lower(${departments.name}) = ${name.toLowerCase()}`, eq(departments.university, req.university))).limit(1)
        if (clash) return { code: 409 as const, error: 'already_exists' }
        const [max] = await tx.select({ m: sql<number>`coalesce(max(${departments.sortOrder}), 0)::int` }).from(departments)
        const sortOrder = (max?.m ?? 0) + 10
        await tx.insert(departments).values({ name, university: req.university, sortOrder })
        // "All campuses": also the template for new campuses, and every other campus that does not have it yet.
        if (body.scope === 'all') {
          await tx.execute(sql`
            insert into departments (name, university, sort_order)
            select ${name}, c.slug, ${sortOrder} from campuses c
            where c.slug <> ${req.university} and not exists (select 1 from departments x where x.university = c.slug and lower(x.name) = ${name.toLowerCase()})`)
          await tx.insert(departments).values({ name, university: null, sortOrder }).onConflictDoNothing()
        }
        resolvedName = name
      } else if (body.action === 'merge') {
        if (!body.departmentId) return { code: 422 as const, error: 'department_required' }
        const [dept] = await tx.select().from(departments).where(eq(departments.id, body.departmentId)).limit(1)
        if (!dept || !dept.active || dept.university !== req.university) return { code: 422 as const, error: 'department_not_applicable' }
        resolvedName = dept.name
      }

      const now = new Date()
      const note = body.action === 'decline' && body.note?.trim() ? body.note.trim().slice(0, 200) : null
      await tx.update(departmentRequests).set({ status: body.action === 'decline' ? 'declined' : 'approved', resolvedName, note, reviewedBy: admin.id, reviewedAt: now })
        .where(inArray(departmentRequests.id, group.map((g) => g.id)))
      // Anyone still showing no department gets the new one; someone who has since chosen another keeps their choice.
      if (resolvedName) {
        await tx.update(users).set({ department: resolvedName }).where(and(inArray(users.id, group.map((g) => g.userId)), eq(users.department, NO_DEPARTMENT)))
      }
      return { code: 200 as const, group, resolvedName, note }
    })
    if (out.code !== 200) return status(out.code, { error: out.error })

    for (const g of out.group) {
      bus.publish(topics.user(g.userId), { type: 'department.request', status: body.action === 'decline' ? 'declined' : 'approved', name: req.name, resolvedName: out.resolvedName, note: out.note })
    }
    await audit(admin.id, `department_request.${body.action}`, { targetType: 'department_request', targetId: req.id, meta: { name: req.name, campus: req.university, resolvedName: out.resolvedName, students: out.group.length }, ip })
    return { ok: true, students: out.group.length }
  }, { body: t.Object({
    requestId: t.String({ format: 'uuid' }),
    action: t.Union([t.Literal('approve'), t.Literal('merge'), t.Literal('decline')]),
    name: t.Optional(t.String({ maxLength: 120 })),
    scope: t.Optional(t.Union([t.Literal('campus'), t.Literal('all')])),
    departmentId: t.Optional(t.String({ format: 'uuid' })),
    note: t.Optional(t.String({ maxLength: 300 })),
  }) })
