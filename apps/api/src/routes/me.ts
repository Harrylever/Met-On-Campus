import { Elysia, t } from "elysia"
import { eq } from "drizzle-orm"
import { intentProfiles, users } from "@moc/db"
import { authed, publicSelf } from "../auth"
import { db } from "../context"

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
  usuallyFree: t.Optional(t.String({ maxLength: 80 })),
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
    return { user: publicSelf(user), profiles, onboarded: profiles.length > 0 }
  })
  .patch(
    "/",
    async ({ user, body }) => {
      const [row] = await db
        .update(users)
        .set(body)
        .where(eq(users.id, user.id))
        .returning()
      return { user: publicSelf(row!) }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
        department: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
        level: t.Optional(t.Integer({ minimum: 100, maximum: 900 })),
      }),
    },
  )
  // Upsert one mode's profile. Turning a mode on/off never touches the others.
  .put(
    "/profiles/:intent",
    async ({ user, params, body }) => {
      const values = {
        ...body,
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
