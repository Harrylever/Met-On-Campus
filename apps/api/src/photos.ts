import { and, eq, inArray, or } from "drizzle-orm"
import sharp from "sharp"
import { connectionRequests, profilePhotos, users } from "@moc/db"
import { db } from "./context"
import { canInteract, type Intent } from "./visibility"
import { store } from "./storage"

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024
const MAX_PIXELS = 40_000_000 // refuse decompression bombs before decoding

/**
 * Turns whatever the student uploaded into one safe, small image. The real format is read from the bytes (the browser's
 * label is ignored), the picture is rotated upright, cropped square, re-encoded as WebP and stripped of all metadata,
 * so camera/location data never leaves the phone's file. Returns null if it is not a usable JPEG, PNG or WebP.
 */
export async function processImage(
  bytes: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    const img = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" })
    const meta = await img.metadata()
    if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format))
      return null
    if ((meta.width ?? 0) < 200 || (meta.height ?? 0) < 200) return null
    return await img
      .rotate()
      .resize(640, 640, { fit: "cover", position: "attention" })
      .webp({ quality: 80 })
      .toBuffer()
  } catch {
    return null
  }
}

export const newPhotoKey = (userId: string) =>
  `photos/${userId}/${crypto.randomUUID()}.webp`

/** Two students are a Romance "match" once the Spark between them was accepted. */
export async function romanceMatched(a: string, b: string) {
  const [row] = await db
    .select({ id: connectionRequests.id })
    .from(connectionRequests)
    .where(
      and(
        eq(connectionRequests.intent, "romance"),
        eq(connectionRequests.status, "accepted"),
        or(
          and(
            eq(connectionRequests.fromUserId, a),
            eq(connectionRequests.toUserId, b),
          ),
          and(
            eq(connectionRequests.fromUserId, b),
            eq(connectionRequests.toUserId, a),
          ),
        ),
      ),
    )
    .limit(1)
  return !!row
}

/** Approved photo ids for these students in one mode (a student's own photo and the viewer's visibility are applied by callers). */
export async function approvedPhotoIds(userIds: string[], intent: Intent) {
  if (userIds.length === 0) return new Map<string, string>()
  const rows = await db
    .select({ id: profilePhotos.id, userId: profilePhotos.userId })
    .from(profilePhotos)
    .where(
      and(
        inArray(profilePhotos.userId, userIds),
        eq(profilePhotos.intent, intent),
        eq(profilePhotos.status, "approved"),
      ),
    )
  return new Map(rows.map((r) => [r.userId, r.id]))
}

type User = typeof users.$inferSelect
/** May `viewer` fetch this photo? Owners always; everyone else only approved photos of a student they may see in that mode, and Romance only after a match. */
export async function mayView(
  viewer: User,
  photo: typeof profilePhotos.$inferSelect,
) {
  if (photo.userId === viewer.id)
    return photo.status === "pending" || photo.status === "approved"
  if (photo.status !== "approved") return false
  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.id, photo.userId))
    .limit(1)
  if (!owner || owner.status !== "active") return false
  if (!(await canInteract(viewer, owner, photo.intent))) return false
  return (
    photo.intent !== "romance" || (await romanceMatched(viewer.id, owner.id))
  )
}

/** Delete the stored file for a photo that is no longer pending or approved. Never throws: a stray file is better than a failed request. */
export const discardFile = (key: string) => store.remove(key).catch(() => {})
