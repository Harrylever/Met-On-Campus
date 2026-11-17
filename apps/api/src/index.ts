import { Elysia } from "elysia"
import { cors } from "@elysiajs/cors"
import { env } from "./env"
import { authRoutes } from "./auth"
import { meRoutes } from "./routes/me"
import { discoverRoutes } from "./routes/discover"
import { connectionRoutes } from "./routes/connections"
import { safetyRoutes } from "./routes/safety"
import { roomRoutes } from "./routes/rooms"
import { presenceRoutes } from "./routes/presence"
import { wsRoutes } from "./ws"

export const app = new Elysia()
  .use(cors({ origin: env.webOrigin, credentials: true }))
  .get("/health", () => ({ ok: true }))
  .use(authRoutes)
  .use(meRoutes)
  .use(discoverRoutes)
  .use(connectionRoutes)
  .use(roomRoutes)
  .use(safetyRoutes)
  .use(presenceRoutes)
  .use(wsRoutes)

// The web app imports this type for Eden Treaty. Nothing else from the api leaks to the client.
export type App = typeof app
