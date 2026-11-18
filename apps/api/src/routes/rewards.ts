import { Elysia } from 'elysia'
import { authed } from '../auth'
import { checkIn, progressOf } from '../rewards/engine'

export const rewardRoutes = new Elysia().use(authed)
  // The app calls this when it opens (and when it comes back to the front on a new day). Safe to call as often as you like:
  // a day counts once.
  .post('/me/checkin', async ({ user }) => checkIn(user.id))
  .get('/me/progress', async ({ user }) => progressOf(user.id))
