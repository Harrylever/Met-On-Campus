import { Elysia } from 'elysia'
import { authed } from '../auth'
import { markBadgesSeen, shelfOf, syncBadges } from '../rewards/badges'
import { checkIn, progressOf } from '../rewards/engine'

export const rewardRoutes = new Elysia().use(authed)
  // The app calls this when it opens (and when it comes back to the front on a new day). Safe to call as often as you like:
  // a day counts once.
  .post('/me/checkin', async ({ user }) => checkIn(user.id))
  .get('/me/progress', async ({ user }) => progressOf(user.id))
  // The shelf: every badge, earned or not. Reading it also catches up anything earned that has not been granted yet.
  .get('/me/badges', async ({ user }) => { await syncBadges(user.id); return shelfOf(user.id) })
  // The student has looked at their new badges.
  .post('/me/badges/seen', async ({ user }) => { await markBadgesSeen(user.id); return { ok: true } })
