import { Elysia, t } from "elysia"
import { and, eq } from "drizzle-orm"
import { intentProfiles, users } from "@moc/db"
import { authed, publicSelf } from "../auth"
import { db } from "../context"
import { canonical, departmentsFor, spotsFor, tidy, validPersonName } from "../lists"

const Intent = t.Union([
  t.Literal("study"),
  t.Literal("friends"),
  t.Literal("romance"),
])
const ProfileBody = t.Object({
  enabled: t.Optional(t.Boolean()),
  prompt: t.Optional(t.String({ maxLength: 160 })),
  bio: t.Optional(t.String({ maxLength: 400 })),
  tags: t.Optional(t.Array(t.String({ maxLength: 24 }), { maxItems: 6 })),
  // Preset choices plus an optional note, joined into one line.
  usuallyFree: t.Optional(t.String({ maxLength: 160 })),
  usualSpot: t.Optional(t.String({ maxLength: 80 })),
  hideFromDepartment: t.Optional(t.Boolean()),
})

export const meRoutes = new Elysia({ prefix: "/me" })
  .use(authed)
  .get("/", async ({ user }) => {
    const profiles = await db
      .select()
      .from(intentProfiles)
      .where(eq(intentProfiles.userId, user.id))
    return { user: publicSelf(user), profiles, onboarded: profiles.length > 0, settings: { emailAlerts: user.emailAlerts } }
  })
  .patch(
    "/",
    async ({ user, body, status }) => {
      const changes = { ...body }
      // The display name is what every other student sees, so it must be a real name or nickname (no digits: matric
      // numbers). Keeping the name you already have is always allowed, so an old one never blocks saving other details.
      if (changes.name !== undefined) {
        const name = tidy(changes.name)
        if (name.toLowerCase() !== user.name.toLowerCase() && !validPersonName(name)) return status(422, { error: "invalid_name" })
        changes.name = name.toLowerCase() === user.name.toLowerCase() ? user.name : name
      }
      // A department must come from the campus list. Keeping the one you already have is always allowed, so an
      // entry staff later archive does not block you from saving the rest of your details.
      if (changes.department !== undefined && tidy(changes.department).toLowerCase() !== user.department.toLowerCase()) {
        const match = canonical(await departmentsFor(user.university), changes.department)
        if (!match) return status(422, { error: "unknown_department" })
        changes.department = match
      } else if (changes.department !== undefined) {
        changes.department = user.department
      }
      const [row] = await db
        .update(users)
        .set(changes)
        .where(eq(users.id, user.id))
        .returning()
      return { user: publicSelf(row!) }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
        department: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
        level: t.Optional(t.Integer({ minimum: 100, maximum: 900 })),
        emailAlerts: t.Optional(t.Boolean()),
      }),
    },
  )
  // Upsert one mode's profile. Turning a mode on/off never touches the others.
  .put(
    "/profiles/:intent",
    async ({ user, params, body, status }) => {
      const changes = { ...body }
      if (changes.usualSpot) {
        const [existing] = await db
          .select({ usualSpot: intentProfiles.usualSpot })
          .from(intentProfiles)
          .where(and(eq(intentProfiles.userId, user.id), eq(intentProfiles.intent, params.intent)))
          .limit(1)
        // Same rule as departments: a spot you already have stays saveable even if staff archived it.
        if (tidy(changes.usualSpot).toLowerCase() === (existing?.usualSpot ?? "").toLowerCase()) {
          changes.usualSpot = existing!.usualSpot
        } else {
          const match = canonical(await spotsFor(user.university), changes.usualSpot)
          if (!match) return status(422, { error: "unknown_spot" })
          changes.usualSpot = match
        }
      }
      const values = {
        ...changes,
        userId: user.id,
        intent: params.intent,
        updatedAt: new Date(),
      }
      const [row] = await db
        .insert(intentProfiles)
        .values(values)
        .onConflictDoUpdate({
          target: [intentProfiles.userId, intentProfiles.intent],
          set: values,
        })
        .returning()
      return { profile: row }
    },
    { params: t.Object({ intent: Intent }), body: ProfileBody },
  )
