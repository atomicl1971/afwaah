import { createContext, serverRouter } from "@campus-chat/trpc/server";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { type Router, Router as createRouter } from "express";

import { verifyAdminPassword } from "../auth/password";
import type { ApiClients } from "../clients";
import type { ApiEnv } from "../env";

export function createTrpcRouter(env: ApiEnv, clients: ApiClients): Router {
  const router = createRouter();

  router.get("/", (_req, res) => {
    res.json({
      endpoint: "/trpc",
      status: "ok",
    });
  });

  router.use(
    createExpressMiddleware({
      createContext({ req }) {
        return createContext({
          adminCookieName: env.ADMIN_COOKIE_NAME,
          adminSessionTtlSeconds: env.ADMIN_SESSION_TTL_SECONDS,
          allowIpLocationFallback: env.LOCATION_IP_FALLBACK_ENABLED,
          db: clients.db,
          redis: clients.redis,
          req: { headers: req.headers },
          sessionCookieName: env.SESSION_COOKIE_NAME,
          verifyAdminPassword,
        });
      },
      onError({ error, path }) {
        console.error("tRPC request failed", {
          code: error.code,
          message: error.message,
          path,
        });
      },
      router: serverRouter,
    }),
  );

  return router;
}
