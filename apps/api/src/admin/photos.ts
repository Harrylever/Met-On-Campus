import { Elysia, t } from 'elysia'
import { and, desc, eq, sql } from 'drizzle-orm'
import { profilePhotos, users } from '@moc/db'
import { bus, db, topics } from '../context'
import { discardFile } from '../photos'
import { onPhotoApproved } from '../rewards/events'
import { store } from '../storage'
import { adminAuthed, audit } from './session'

const card = {
  id: profilePhotos.id, intent: profilePhotos.intent, status: profilePhotos.status, createdAt: profilePhotos.createdAt, reviewedAt: profilePhotos.reviewedAt,
  userId: users.id, name: users.name, university: users.university, department: users.department, level: users.level,
}

/**
 * Photo review. Nothing a student uploads is shown to anyone else until staff approve it here. Staff can also take a live
 * photo down. Every decision is audited and the student is told straight away.
 */
export const adminPhotos = new Elysia({ prefix: '/admin/photos' }).use(adminAuthed)
  .get('/', async () => {
    const pending = await db.select({ ...card, replacing: sql<boolean>`exists (select 1 from profile_photos p2 where p2.user_id = ${profilePhotos.userId} and p2.intent = ${profilePhotos.intent} and p2.status = 'approved')` })
      .from(profilePhotos).innerJoin(users, eq(users.id, profilePhotos.userId)).where(eq(profilePhotos.status, 'pending')).orderBy(profilePhotos.createdAt).limit(100)
    const live = await db.select(card).from(profilePhotos).innerJoin(users, eq(users.id, profilePhotos.userId))
      .where(eq(profilePhotos.status, 'approved')).orderBy(desc(profilePhotos.reviewedAt)).limit(40)
    return { pending, live }
  })

  // The picture, for the review screen. Only reachable with the platform's service token plus a staff session.
  .get('/:id/image', async ({ params, status }) => {
    const [p] = await db.select().from(profilePhotos).where(eq(profilePhotos.id, params.id)).limit(1)
    if (!p || (p.status !== 'pending' && p.status !== 'approved')) return status(404, { error: 'not_found' })
    const bytes = await store.get(p.storageKey)
    if (!bytes) return status(404, { error: 'not_found' })
    return new Response(new Blob([bytes as BlobPart], { type: 'image/webp' }), { headers: { 'content-type': 'image/webp', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
  }, { params: t.Object({ id: t.String({ format: 'uuid' }) }) })

  .post('/resolve', async ({ admin, body, ip, status }) => {
    const note = body.note?.trim() ? body.note.trim().slice(0, 200) : null
    const out = await db.transaction(async (tx) => {
      const [p] = await tx.select().from(profilePhotos).where(eq(profilePhotos.id, body.photoId)).for('update').limit(1)
      if (!p) return { code: 404 as const, error: 'not_found' }
      const wanted = body.action === 'remove' ? 'approved' : 'pending'
      if (p.status !== wanted) return { code: 409 as const, error: 'already_resolved' }
      const stale: string[] = []
      if (body.action === 'approve') {
        // The new photo takes over from the one that was live; only one approved photo per mode.
        const old = await tx.update(profilePhotos).set({ status: 'replaced' })
          .where(and(eq(profilePhotos.userId, p.userId), eq(profilePhotos.intent, p.intent), eq(profilePhotos.status, 'approved'))).returning({ key: profilePhotos.storageKey })
        stale.push(...old.map((o) => o.key))
      } else stale.push(p.storageKey)
      const next = body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : 'removed'
      await tx.update(profilePhotos).set({ status: next, note: body.action === 'approve' ? null : note, reviewedBy: admin.id, reviewedAt: new Date() }).where(eq(profilePhotos.id, p.id))
      return { code: 200 as const, p, next, stale }
    })
    if (out.code !== 200) return status(out.code, { error: out.error })
    await Promise.all(out.stale.map((k) => discardFile(k)))
    if (body.action === 'approve') await onPhotoApproved(out.p.userId, out.p.intent)
    bus.publish(topics.user(out.p.userId), { type: 'photo.review', intent: out.p.intent, status: out.next, note })
    await audit(admin.id, `photo.${body.action}`, { targetType: 'photo', targetId: out.p.id, meta: { userId: out.p.userId, intent: out.p.intent, note }, ip })
    return { ok: true }
  }, { body: t.Object({
    photoId: t.String({ format: 'uuid' }),
    action: t.Union([t.Literal('approve'), t.Literal('reject'), t.Literal('remove')]),
    note: t.Optional(t.String({ maxLength: 300 })),
  }) })
