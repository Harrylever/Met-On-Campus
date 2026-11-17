import { Elysia, t } from "elysia"
import { and, desc, eq, inArray } from "drizzle-orm"
import { intentProfiles, profilePhotos } from "@moc/db"
import { authed } from "../auth"
import { db } from "../context"
import { hit } from "../ratelimit"
import { store, photosEnabled } from "../storage"
import {
  discardFile,
  MAX_UPLOAD_BYTES,
  mayView,
  newPhotoKey,
  processImage,
} from "../photos"

const Intent = t.Union([
  t.Literal("study"),
  t.Literal("friends"),
  t.Literal("romance"),
])
const REJECTED_DAYS = 30

export const photoRoutes = new Elysia()
  .use(authed)
  // My photos per mode: what others see (approved), what is waiting for staff (pending), and a recent "no" with its reason.
  .get("/me/photos", async ({ user }) => {
    const rows = await db
      .select()
      .from(profilePhotos)
      .where(eq(profilePhotos.userId, user.id))
      .orderBy(desc(profilePhotos.createdAt))
    const byIntent = Object.fromEntries(
      (["study", "friends", "romance"] as const).map((i) => {
        const mine = rows.filter((r) => r.intent === i)
        const approved = mine.find((r) => r.status === "approved") ?? null
        const pending = mine.find((r) => r.status === "pending") ?? null
        const latest = mine[0]
        const rejected =
          !pending &&
          latest?.status === "rejected" &&
          Date.now() - +(latest.reviewedAt ?? latest.createdAt) <
            REJECTED_DAYS * 86_400_000
            ? latest
            : null
        return [
          i,
          {
            approved: approved && { id: approved.id },
            pending: pending && { id: pending.id },
            rejected: rejected && { id: rejected.id, note: rejected.note },
          },
        ]
      }),
    )
    return { enabled: photosEnabled, photos: byIntent }
  })

  .post(
    "/me/photos",
    async ({ user, body, status }) => {
      if (!photosEnabled) return status(503, { error: "photos_unavailable" })
      const [profile] = await db
        .select({ userId: intentProfiles.userId })
        .from(intentProfiles)
        .where(
          and(
            eq(intentProfiles.userId, user.id),
            eq(intentProfiles.intent, body.intent),
            eq(intentProfiles.enabled, true),
          ),
        )
        .limit(1)
      if (!profile) return status(403, { error: "mode_not_enabled" })
      if (body.file.size > MAX_UPLOAD_BYTES)
        return status(413, { error: "too_large" })
      if (await hit(`photo:${user.id}`, 5, 86_400))
        return status(429, { error: "too_many_uploads" })

      const processed = await processImage(
        new Uint8Array(await body.file.arrayBuffer()),
      )
      if (!processed) return status(422, { error: "invalid_image" })
      const key = newPhotoKey(user.id)
      await store.put(key, processed)

      try {
        const replaced = await db.transaction(async (tx) => {
          // A newer upload replaces one that is still waiting; the approved photo stays live until this one is approved.
          const old = await tx
            .update(profilePhotos)
            .set({ status: "replaced" })
            .where(
              and(
                eq(profilePhotos.userId, user.id),
                eq(profilePhotos.intent, body.intent),
                eq(profilePhotos.status, "pending"),
              ),
            )
            .returning({ key: profilePhotos.storageKey })
          await tx
            .insert(profilePhotos)
            .values({ userId: user.id, intent: body.intent, storageKey: key })
          return old
        })
        await Promise.all(replaced.map((r) => discardFile(r.key)))
      } catch (e) {
        await discardFile(key)
        throw e
      }
      return { ok: true }
    },
    { body: t.Object({ intent: Intent, file: t.File() }) },
  )

  // Take down one of my photos (approved or still pending).
  .delete(
    "/me/photos/:id",
    async ({ user, params, status }) => {
      const [row] = await db
        .update(profilePhotos)
        .set({ status: "removed" })
        .where(
          and(
            eq(profilePhotos.id, params.id),
            eq(profilePhotos.userId, user.id),
            inArray(profilePhotos.status, ["pending", "approved"]),
          ),
        )
        .returning()
      if (!row) return status(404, { error: "not_found" })
      await discardFile(row.storageKey)
      return { ok: true }
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) },
  )

  // The image itself. Private: never a public URL. Cookies identify the viewer, and the same rules as Discover apply.
  .get(
    "/photos/:id",
    async ({ user, params, status }) => {
      const [photo] = await db
        .select()
        .from(profilePhotos)
        .where(eq(profilePhotos.id, params.id))
        .limit(1)
      if (!photo || !(await mayView(user, photo)))
        return status(404, { error: "not_found" })
      const bytes = await store.get(photo.storageKey)
      if (!bytes) return status(404, { error: "not_found" })
      return new Response(new Blob([bytes as BlobPart], { type: "image/webp" }), {
        headers: {
          "content-type": "image/webp",
          "x-content-type-options": "nosniff",
          "cross-origin-resource-policy": "same-site",
          // Short, private cache: a block, an unmatch or a staff removal stops the image within minutes.
          "cache-control": "private, max-age=300",
        },
      })
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) },
  )
