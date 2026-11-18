import { Elysia, t } from 'elysia'
import { revokeBadge } from '../rewards/badges'
import { reversePoints } from '../rewards/engine'
import { adminAuthed, audit } from './session'

export const adminRewards = new Elysia({ prefix: '/admin/points' }).use(adminAuthed)
  // Undo an award that should not have been paid (abuse, a bug). Needs a written reason, and is audited.
  .post('/:id/reverse', async ({ admin, params, body, ip, status }) => {
    if (body.note.trim().length < 5) return status(422, { error: 'note_required' })
    const r = await reversePoints(params.id, admin.id, body.note.trim())
    if (r.code !== 200) return status(r.code, { error: r.code === 404 ? 'not_found' : 'already_reversed' })
    await audit(admin.id, 'points.reverse', { targetType: 'point_event', targetId: params.id, meta: { userId: r.event.userId, kind: r.event.kind, points: r.event.points, note: body.note.trim().slice(0, 200) }, ip })
    return { ok: true }
  }, { params: t.Object({ id: t.String({ format: 'uuid' }) }), body: t.Object({ note: t.String({ maxLength: 300 }) }) })

// Take a badge back (for example one earned through abuse). Needs a written reason, is audited, and the badge is never re-granted.
export const adminBadges = new Elysia({ prefix: '/admin/users' }).use(adminAuthed)
  .post('/:id/badges/:badge/revoke', async ({ admin, params, body, ip, status }) => {
    if (body.note.trim().length < 5) return status(422, { error: 'note_required' })
    const row = await revokeBadge(params.id, params.badge, admin.id, body.note.trim())
    if (!row) return status(404, { error: 'not_found' })
    await audit(admin.id, 'badge.revoke', { targetType: 'user', targetId: params.id, meta: { badge: params.badge, note: body.note.trim().slice(0, 200) }, ip })
    return { ok: true }
  }, { params: t.Object({ id: t.String({ format: 'uuid' }), badge: t.String({ maxLength: 40 }) }), body: t.Object({ note: t.String({ maxLength: 300 }) }) })
