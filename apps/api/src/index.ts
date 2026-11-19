import { Elysia } from "elysia"
import { cors } from "@elysiajs/cors"
import { env } from "./env"
import { authRoutes } from "./auth"
import { meRoutes } from "./routes/me"
import { discoverRoutes } from "./routes/discover"
import { connectionRoutes } from "./routes/connections"
import { safetyRoutes } from "./routes/safety"
import { metaRoutes } from "./routes/meta"
import { roomRoutes } from "./routes/rooms"
import { presenceRoutes } from "./routes/presence"
import { wsRoutes } from "./ws"
import { adminAuthRoutes, adminSessionRoutes } from "./admin/auth-routes"
import { adminRoutes } from "./admin/routes"
import { adminCampuses } from "./admin/campuses"
import { adminList } from "./admin/lists"
import { adminDepartmentRequests } from "./admin/department-requests"
import { adminBroadcasts } from "./admin/broadcasts"
import { adminPhotos } from "./admin/photos"
import { adminBadges, adminRewards } from "./admin/rewards"
import { photoRoutes } from "./routes/photos"
import { accountRoutes } from "./routes/account"
import { alertRoutes } from "./routes/alerts"
import { pushRoutes } from "./routes/push"
import { rewardRoutes } from "./routes/rewards"
import { devEmailRoutes } from "./routes/dev-email"
import { departmentRequestRoutes } from "./routes/department-requests"
import { adminServiceGate } from "./admin/session"
import { recordRequest } from "./metrics"

export const app = new Elysia()
  // Every /admin/* request must carry the platform server's secret before anything else runs.
  .onRequest(({ request }) => adminServiceGate(request))
  .onAfterResponse({ as: "global" }, ({ set }) => recordRequest(Number(set.status ?? 200)))
  .use(cors({ origin: env.webOrigin, credentials: true }))
  .get("/health", () => ({ ok: true }))
  .use(authRoutes)
  .use(meRoutes)
  .use(discoverRoutes)
  .use(connectionRoutes)
  .use(roomRoutes)
  .use(safetyRoutes)
  .use(metaRoutes)
  .use(departmentRequestRoutes)
  .use(photoRoutes)
  .use(accountRoutes)
  .use(alertRoutes)
  .use(pushRoutes)
  .use(rewardRoutes)
  .use(env.isProd ? new Elysia() : devEmailRoutes) // email previews: development only
  .use(presenceRoutes)
  .use(wsRoutes)
  .use(adminAuthRoutes)
  .use(adminSessionRoutes)
  .use(adminRoutes)
  .use(adminCampuses)
  .use(adminList("departments"))
  .use(adminList("spots"))
  .use(adminDepartmentRequests)
  .use(adminBroadcasts)
  .use(adminPhotos)
  .use(adminRewards)
  .use(adminBadges)

// The web app imports this type for Eden Treaty. Nothing else from the api leaks to the client.
export type App = typeof app
