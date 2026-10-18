import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { app, httpSecurity } from "../apps/api/src/app.js";
import { config } from "../apps/api/src/config.js";
import {
  admin,
  body,
  human,
  sessionActor,
} from "../apps/api/src/auth/model.js";
import { handleError, type Env } from "../apps/api/src/http.js";
import {
  trustedOrigin,
  rateLimit,
  readAuthority,
  mutationAuthority,
} from "../apps/api/src/middleware.js";
import { capabilities } from "../apps/api/src/social/capabilities.js";
import { createSocialRoutes } from "../apps/api/src/social/routes.js";
import { previewOAuth } from "./preview-oauth.js";
import { PROVIDERS } from "../packages/contracts/src/index.js";
import { sql } from "../packages/database/src/index.js";

async function previewWorkspace() {
  const [workspace] = await sql<
    { id: string; name: string }[]
  >`SELECT id,name FROM workspace`;
  if (!workspace || workspace.name !== "Posted Preview")
    throw new HTTPException(403, {
      message: "This is not the disposable preview installation",
    });
  return workspace;
}

export async function createPreviewApi() {
  const settings = config();
  if (
    settings.NODE_ENV === "production" ||
    [
      settings.DATABASE_URL,
      settings.POSTED_API_URL,
      settings.POSTED_WEB_URL,
    ].some(
      (value) => !["localhost", "127.0.0.1"].includes(new URL(value).hostname),
    )
  )
    throw new Error(
      "Preview fixtures require a disposable loopback installation",
    );
  await previewWorkspace();

  const oauth = previewOAuth(settings.POSTED_WEB_URL, settings.POSTED_API_URL);
  const fixtures = new Hono<Env>();
  fixtures.onError(handleError);
  fixtures.use(
    "*",
    httpSecurity,
    cors({
      origin: new URL(settings.POSTED_WEB_URL).origin,
      credentials: true,
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
    bodyLimit({ maxSize: 2048 }),
  );
  fixtures.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    // Fixture connections require a browser session, never a credential grant.
    if (!c.req.header("authorization")) {
      const actor = await sessionActor(c.req.raw);
      if (actor) c.set("actor", actor);
    }
    await next();
  });
  fixtures.use("*", async (_c, next) => {
    await previewWorkspace();
    await next();
  });
  fixtures.use("*", trustedOrigin, rateLimit, readAuthority, mutationAuthority);
  fixtures.get("/api/providers", async (c) => {
    human(c);
    return c.json({ providers: Object.values(capabilities) });
  });
  fixtures.get("/api/preview/social/authorization", async (c) => {
    const actor = admin(c);
    const provider = z.enum(PROVIDERS).parse(c.req.query("provider"));
    const state = z.string().parse(c.req.query("state"));
    return c.json(await oauth.authorization(provider, state, actor.userId));
  });
  fixtures.post("/api/preview/social/decision", async (c) => {
    const actor = admin(c);
    const input = await body(
      c,
      z
        .object({
          provider: z.enum(PROVIDERS),
          state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          decision: z.enum(["approve", "deny"]),
        })
        .strict(),
    );
    return c.json(
      await oauth.decide(
        input.provider,
        input.state,
        actor.userId,
        input.decision,
      ),
    );
  });
  fixtures.route("/", createSocialRoutes(oauth.providerClient));
  return {
    fetch(request: Request) {
      const path = new URL(request.url).pathname;
      const fixtureRoute =
        (path === "/api/providers" &&
          ["GET", "OPTIONS"].includes(request.method)) ||
        (path.startsWith("/api/social/connect/") &&
          ["POST", "OPTIONS"].includes(request.method)) ||
        (path.startsWith("/api/social/callback/") &&
          request.method === "GET") ||
        (path.startsWith("/api/social/linkedin-pages/authorizations/") &&
          ["GET", "POST", "DELETE", "OPTIONS"].includes(request.method)) ||
        (path.startsWith("/api/preview/social/") &&
          ["GET", "POST", "OPTIONS"].includes(request.method));
      return fixtureRoute ? fixtures.fetch(request) : app.fetch(request);
    },
  };
}
