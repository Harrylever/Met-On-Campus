import { Elysia, t } from "elysia"
import { and, desc, eq } from "drizzle-orm"
import { departmentRequests } from "@moc/db"
import { authed } from "../auth"
import { db } from "../context"
import { canonical, departmentsFor, tidy, validListName } from "../lists"
import { hit } from "../ratelimit"

const present = (r: typeof departmentRequests.$inferSelect) => ({
  id: r.id, name: r.name, status: r.status, resolvedName: r.resolvedName, note: r.note, createdAt: r.createdAt, reviewedAt: r.reviewedAt,
})
const isUniqueViolation = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505"

// A student whose department is not listed asks for it. One open request at a time, and a few per day.
export const departmentRequestRoutes = new Elysia({ prefix: "/me/department-requests" })
  .use(authed)
  .get("/", async ({ user }) => {
    const rows = await db.select().from(departmentRequests).where(eq(departmentRequests.userId, user.id)).orderBy(desc(departmentRequests.createdAt)).limit(5)
    return { requests: rows.map(present) }
  })
  .post("/", async ({ user, body, status, set }) => {
    const name = tidy(body.name)
    if (!validListName(name)) return status(422, { error: "invalid_name" })
    // If it is already on the list, point them at it instead of creating work for staff.
    const listed = canonical(await departmentsFor(user.university), name)
    if (listed) return status(409, { error: "already_listed", name: listed })
    const [open] = await db.select({ id: departmentRequests.id }).from(departmentRequests).where(and(eq(departmentRequests.userId, user.id), eq(departmentRequests.status, "pending"))).limit(1)
    if (open) return status(409, { error: "already_requested" })
    const wait = await hit(`deptreq:${user.id}`, 3, 86_400)
    if (wait) { set.headers["retry-after"] = String(wait); return status(429, { error: "too_many_requests", retryAfter: wait }) }
    try {
      const [row] = await db.insert(departmentRequests).values({ userId: user.id, university: user.university, name }).returning()
      return { request: present(row!) }
    } catch (e) {
      if (isUniqueViolation(e)) return status(409, { error: "already_requested" }) // two taps at once
      throw e
    }
  }, { body: t.Object({ name: t.String({ maxLength: 120 }) }) })
  // Changed their mind, or typed it wrong: withdraw the open request.
  .delete("/:id", async ({ user, params, status }) => {
    const [row] = await db.update(departmentRequests).set({ status: "withdrawn" })
      .where(and(eq(departmentRequests.id, params.id), eq(departmentRequests.userId, user.id), eq(departmentRequests.status, "pending"))).returning()
    if (!row) return status(404, { error: "not_found" })
    return { ok: true }
  }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })
