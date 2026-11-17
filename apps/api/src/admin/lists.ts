import { Elysia, t } from 'elysia'
import { and, eq, sql } from 'drizzle-orm'
import { campusSpots, departments, intentProfiles, users } from '@moc/db'
import { db } from '../context'
import { tidy } from '../lists'
import { adminAuthed, audit } from './session'

type Kind = 'departments' | 'spots'
const table = { departments, spots: campusSpots } as const
const label = { departments: 'department', spots: 'spot' } as const

// Letters, digits and ordinary punctuation only: these names are shown to students and stored as plain text.
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,'&()\/-]{1,59}$/u
const validName = (s: string) => NAME_RE.test(s)

/** How many students use each entry: users for departments, profiles that name it as a usual spot for spots. */
async function usageCounts(kind: Kind): Promise<{ name: string; university: string; n: number }[]> {
  if (kind === 'departments') {
    return db.select({ name: users.department, university: users.university, n: sql<number>`count(*)::int` }).from(users).groupBy(users.department, users.university)
  }
  return db.select({ name: intentProfiles.usualSpot, university: users.university, n: sql<number>`count(*)::int` })
    .from(intentProfiles).innerJoin(users, eq(users.id, intentProfiles.userId)).groupBy(intentProfiles.usualSpot, users.university)
}
const usedBy = (counts: Awaited<ReturnType<typeof usageCounts>>, name: string, scope: string | null) =>
  counts.filter((c) => c.name.toLowerCase() === name.toLowerCase() && (scope === null || c.university === scope)).reduce((s, c) => s + c.n, 0)

/** Moving students from the old name to the new one so renames never leave stale text behind. */
async function cascadeRename(tx: Pick<typeof db, 'update' | 'select'>, kind: Kind, from: string, to: string, scope: string | null) {
  if (kind === 'departments') {
    await tx.update(users).set({ department: to }).where(and(sql`lower(${users.department}) = ${from.toLowerCase()}`, scope ? eq(users.university, scope) : undefined))
  } else {
    const inCampus = scope ? sql`${intentProfiles.userId} in (select id from users where university = ${scope})` : undefined
    await tx.update(intentProfiles).set({ usualSpot: to }).where(and(sql`lower(${intentProfiles.usualSpot}) = ${from.toLowerCase()}`, inCampus))
  }
}

const duplicate = async (kind: Kind, name: string, scope: string | null, exceptId?: string) => {
  const t_ = table[kind]
  const rows = await db.select({ id: t_.id }).from(t_).where(and(sql`lower(${t_.name}) = ${name.toLowerCase()}`, sql`coalesce(${t_.university}, '') = ${scope ?? ''}`))
  return rows.some((r) => r.id !== exceptId)
}

/** Staff-managed list (departments or campus spots): list, add, rename, archive/restore, delete when unused. */
export function adminList(kind: Kind) {
  const t_ = table[kind]
  const what = label[kind]
  return new Elysia({ prefix: `/admin/${kind}` }).use(adminAuthed)
    .get('/', async () => {
      const [rows, counts, campusRows, listCampuses] = await Promise.all([
        db.select().from(t_).orderBy(t_.sortOrder, t_.name),
        usageCounts(kind),
        db.selectDistinct({ u: users.university }).from(users),
        db.selectDistinct({ u: t_.university }).from(t_),
      ])
      const campuses = [...new Set([...campusRows.map((c) => c.u), ...listCampuses.map((c) => c.u).filter((u): u is string => !!u)])].sort()
      return { items: rows.map((r) => ({ id: r.id, name: r.name, university: r.university, active: r.active, inUse: usedBy(counts, r.name, r.university) })), campuses }
    })

    .post('/', async ({ admin, body, ip, status }) => {
      const name = tidy(body.name)
      const scope = body.university ? body.university.trim().toLowerCase() : null
      if (!validName(name)) return status(422, { error: 'invalid_name' })
      if (await duplicate(kind, name, scope)) return status(409, { error: 'duplicate' })
      const [max] = await db.select({ m: sql<number>`coalesce(max(${t_.sortOrder}), 0)::int` }).from(t_)
      const [row] = await db.insert(t_).values({ name, university: scope, sortOrder: (max?.m ?? 0) + 10 }).returning()
      await audit(admin.id, `${what}.create`, { targetType: what, targetId: row!.id, meta: { name, campus: scope ?? 'all' }, ip })
      return { id: row!.id }
    }, { body: t.Object({ name: t.String({ maxLength: 120 }), university: t.Optional(t.Union([t.String({ maxLength: 60 }), t.Null()])) }) })

    // Rename and/or archive/restore. A rename carries over to every student who has the old name.
    .patch('/:id', async ({ admin, params, body, ip, status }) => {
      const [row] = await db.select().from(t_).where(eq(t_.id, params.id)).limit(1)
      if (!row) return status(404, { error: 'not_found' })
      const name = body.name !== undefined ? tidy(body.name) : row.name
      if (body.name !== undefined && !validName(name)) return status(422, { error: 'invalid_name' })
      const renamed = name !== row.name
      if (renamed && (await duplicate(kind, name, row.university, row.id))) return status(409, { error: 'duplicate' })
      await db.transaction(async (tx) => {
        await tx.update(t_).set({ name, ...(body.active !== undefined ? { active: body.active } : {}) }).where(eq(t_.id, row.id))
        if (renamed) await cascadeRename(tx, kind, row.name, name, row.university)
      })
      if (renamed) await audit(admin.id, `${what}.rename`, { targetType: what, targetId: row.id, meta: { from: row.name, to: name }, ip })
      if (body.active !== undefined && body.active !== row.active) await audit(admin.id, `${what}.${body.active ? 'restore' : 'archive'}`, { targetType: what, targetId: row.id, meta: { name }, ip })
      return { ok: true }
    }, { params: t.Object({ id: t.String({ format: 'uuid' }) }), body: t.Object({ name: t.Optional(t.String({ maxLength: 120 })), active: t.Optional(t.Boolean()) }) })

    // Only unused entries can be deleted. Archive anything students still have, so it stops being offered to new people.
    .delete('/:id', async ({ admin, params, ip, status }) => {
      const [row] = await db.select().from(t_).where(eq(t_.id, params.id)).limit(1)
      if (!row) return status(404, { error: 'not_found' })
      const inUse = usedBy(await usageCounts(kind), row.name, row.university)
      if (inUse > 0) return status(409, { error: 'in_use', inUse })
      await db.delete(t_).where(eq(t_.id, row.id))
      await audit(admin.id, `${what}.delete`, { targetType: what, targetId: row.id, meta: { name: row.name }, ip })
      return { ok: true }
    }, { params: t.Object({ id: t.String({ format: 'uuid' }) }) })
}
