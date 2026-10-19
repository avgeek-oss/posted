import { createHash } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  sql,
  withDatabaseTransaction,
} from "../../../packages/database/src/index.js";
import { clientAddress, type Env } from "./http.js";
import { config } from "./config.js";
import { lockAuthority } from "./authority.js";
import { mcpResource } from "./external/protocol.js";
class RetryTransactionRollback extends Error {}
export const trustedOrigin: MiddlewareHandler<Env> = async (c, next) => {
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(config().POSTED_WEB_URL).origin)
    throw new HTTPException(403, {
      message: "This request came from an untrusted website",
    });
  if (
    !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
    c.req.header("cookie") &&
    !origin
  )
    throw new HTTPException(403, {
      message: "A trusted Origin is required for browser changes",
    });
  await next();
};
export const rateLimit: MiddlewareHandler<Env> = async (c, next) => {
  const a = c.get("actor");
  const client = clientAddress(c);
  const key = a ? `actor:${a.credentialId ?? a.userId}` : `anonymous:${client}`;
  const limit = a ? 240 : 120;
  const [r] =
    await sql`INSERT INTO request_limits (key,count,reset_at) VALUES (${key},1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.reset_at<now() THEN 1 ELSE request_limits.count+1 END,reset_at=CASE WHEN request_limits.reset_at<now() THEN now()+interval '1 minute' ELSE request_limits.reset_at END RETURNING count,reset_at`;
  if (r.count > limit) {
    c.header("Retry-After", "60");
    throw new HTTPException(429, {
      message: "Too many requests. Try again in a minute.",
    });
  }
  await next();
};
async function currentAuthority(c: Context<Env>) {
  const a = c.get("actor");
  if (a.credentialId) {
    const [row] =
      await sql`SELECT u.role,c.revoked_at,c.expires_at,u.disabled_at,c.token_type,c.resource,c.scopes,c.access_level,c.include_admin FROM credentials c LEFT JOIN users u ON u.id=c.user_id WHERE c.id=${a.credentialId} AND (c.user_id=${a.userId} OR (c.user_id IS NULL AND c.created_by=${a.userId})) FOR SHARE OF c`;
    if (
      !row ||
      (a.kind !== "team" && row.disabledAt) ||
      row.revokedAt ||
      (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now())
    )
      throw new HTTPException(401, {
        message: "This credential is no longer valid",
      });
    if (
      row.tokenType === "oauth" &&
      a.kind === "oauth" &&
      row.resource === mcpResource()
    ) {
      c.set("actor", {
        ...a,
        scopes: row.scopes,
        includeAdmin: row.includeAdmin,
      });
    } else {
      if (
        row.tokenType !== "api-key" ||
        !["human", "team"].includes(a.kind) ||
        row.scopes.length
      )
        throw new HTTPException(401, {
          message: "This credential is no longer valid",
        });
      c.set("actor", {
        ...a,
        role:
          a.kind === "team"
            ? row.includeAdmin
              ? "admin"
              : row.accessLevel === "edit"
                ? "member"
                : "viewer"
            : row.role,
        scopes: row.accessLevel === "edit" ? ["read", "write"] : ["read"],
        includeAdmin: row.includeAdmin,
      });
    }
    if (a.kind !== "team" && row.role !== a.role)
      throw new HTTPException(403, {
        message: "Your permissions changed. Reload Posted before trying again.",
      });
  } else {
    const token = c.req
      .header("cookie")
      ?.match(/(?:^|;\s*)posted_session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
    if (!token)
      throw new HTTPException(401, { message: "Sign in to continue" });
    const hash = createHash("sha256").update(token).digest("hex");
    const [row] =
      await sql`SELECT u.role,u.disabled_at,s.expires_at,u.security_epoch AS user_epoch,s.security_epoch AS session_epoch FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=${a.userId} AND s.token_hash=${hash} FOR SHARE OF u,s`;
    if (
      !row ||
      row.disabledAt ||
      new Date(row.expiresAt).getTime() <= Date.now() ||
      row.userEpoch !== row.sessionEpoch
    )
      throw new HTTPException(401, {
        message: "Your session expired. Sign in again.",
      });
    if (row.role !== a.role)
      throw new HTTPException(403, {
        message: "Your permissions changed. Reload Posted before trying again.",
      });
  }
}
export const readAuthority: MiddlewareHandler<Env> = async (c, next) => {
  if (
    !c.get("actor") ||
    !["GET", "HEAD"].includes(c.req.method) ||
    c.req.path.startsWith("/api/social/callback/")
  )
    return next();
  return withDatabaseTransaction(async () => {
    await sql`SELECT id FROM workspace FOR SHARE`;
    await currentAuthority(c);
    await next();
  });
};

export async function withMutationAuthority<T>(
  c: Context<Env>,
  operation: () => Promise<T>,
) {
  return withDatabaseTransaction(async () => {
    await sql.begin(lockAuthority);
    await currentAuthority(c);
    const result = await operation();
    await currentAuthority(c);
    return result;
  });
}

export const mutationAuthority: MiddlewareHandler<Env> = async (c, next) => {
  if (
    !c.get("actor") ||
    c.req.path.startsWith("/api/auth/") ||
    (c.req.method === "GET" &&
      /^\/api\/social\/callback\/(?:linkedin-pages|facebook-pages)$/.test(
        c.req.path,
      )) ||
    (c.req.method === "POST" &&
      /^\/api\/social\/(?:linkedin-pages|facebook-pages)\/authorizations\/[^/]+$/.test(
        c.req.path,
      )) ||
    (!c.req.path.startsWith("/api/social/callback/") &&
      !["POST", "PATCH", "DELETE"].includes(c.req.method))
  )
    return next();
  return withMutationAuthority(c, async () => {
    await next();
    if (c.res.status >= 400) throw new RetryTransactionRollback();
  }).catch((error) => {
    if (!(error instanceof RetryTransactionRollback)) throw error;
  });
};
