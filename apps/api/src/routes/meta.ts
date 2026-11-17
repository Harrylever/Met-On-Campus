import { Elysia } from "elysia"
import { authed } from "../auth"
import { departmentsFor, FREE_TIME_PRESETS, spotsFor } from "../lists"

// The lists a signed-in student can choose from, for their own campus. Staff edit them from the platform.
export const metaRoutes = new Elysia().use(authed).get("/meta", async ({ user }) => ({
  departments: await departmentsFor(user.university),
  spots: await spotsFor(user.university),
  freeTimes: FREE_TIME_PRESETS,
}))
