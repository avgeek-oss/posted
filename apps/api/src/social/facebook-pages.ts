import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  sql,
  withDatabaseTransaction,
} from "../../../../packages/database/src/index.js";
import type { FacebookPage } from "../../../../packages/contracts/src/index.js";
import { requireHuman, requireRole, type Env } from "../http.js";
import { withMutationAuthority } from "../middleware.js";
import { seal, unseal } from "./secrets.js";
import {
  credentialsSchema,
  refreshCredentials,
  type SocialCredentials,
} from "./tokens.js";
import { facebookJson, facebookScopes } from "./facebook-api.js";
import { checkMetaAuthorization, metaSubjectHash } from "./meta-callbacks.js";

const pageSchema = z.object({
  accountId: z.string().regex(/^[0-9]+$/),
  name: z.string().min(1),
  handle: z.string().min(1),
  avatarUrl: z.url().nullable(),
  accessToken: z.string().min(1),
});
const grantSchema = z.object({
  credential: credentialsSchema,
  pages: z.array(pageSchema),
});
export type FacebookPageGrant = FacebookPage & { accessToken: string };
const publishingTasks = new Set([
  "CREATE_CONTENT",
  "MANAGE",
  "PROFILE_PLUS_CREATE_CONTENT",
  "PROFILE_PLUS_FULL_CONTROL",
  "PROFILE_PLUS_MANAGE",
]);
export async function facebookPages(
  token: string,
  accountIds?: string[],
): Promise<FacebookPageGrant[]> {
  const permissions = await facebookJson(
    "me/permissions",
    token,
    z.object({
      data: z.array(z.object({ permission: z.string(), status: z.string() })),
    }),
  );
  if (
    !facebookScopes.every((scope) =>
      permissions.data.some(
        (p) => p.permission === scope && p.status === "granted",
      ),
    )
  )
    throw new HTTPException(403, {
      message:
        "Allow Page listing, reading and publishing, then connect Facebook Pages again.",
    });
  const pages: FacebookPageGrant[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let count = 0; count < 20; count++) {
    const query = new URLSearchParams({
      fields:
        "id,name,username,picture.width(200).height(200),access_token,tasks",
      limit: "100",
      ...(cursor ? { after: cursor } : {}),
    });
    const response = await facebookJson(
      `me/accounts?${query}`,
      token,
      z.object({
        data: z.array(
          z.object({
            id: z.string().regex(/^[0-9]+$/),
            name: z.string().min(1),
            username: z.string().optional(),
            access_token: z.string().min(1),
            tasks: z.array(z.string()),
            picture: z
              .object({
                data: z.object({
                  url: z.url(),
                  is_silhouette: z.boolean().optional(),
                }),
              })
              .optional(),
          }),
        ),
        paging: z
          .object({
            cursors: z
              .object({ after: z.string().min(1).max(4096).optional() })
              .optional(),
            next: z.string().optional(),
          })
          .optional(),
      }),
    );
    for (const page of response.data) {
      if (
        !page.tasks.some((task) => publishingTasks.has(task)) ||
        (accountIds && !accountIds.includes(page.id))
      )
        continue;
      if (pages.some((value) => value.accountId === page.id))
        throw new Error("Facebook returned a repeated Page identity");
      pages.push({
        accountId: page.id,
        name: page.name,
        handle: page.username || page.id,
        avatarUrl:
          page.picture?.data.url &&
          new URL(page.picture.data.url).protocol === "https:"
            ? page.picture.data.url
            : null,
        accessToken: page.access_token,
      });
    }
    if (!response.paging?.next) return pages;
    cursor = response.paging.cursors?.after;
    if (!cursor || seen.has(cursor))
      throw new Error("Facebook returned an invalid Page cursor");
    seen.add(cursor);
  }
  throw new HTTPException(400, {
    message: "Too many Facebook Pages to load. Contact your operator.",
  });
}
export async function saveFacebookPageGrant(
  userId: string,
  stateHash: string,
  credential: SocialCredentials,
  pages: FacebookPageGrant[],
  subjectId: string,
) {
  const id = randomUUID();
  await withDatabaseTransaction(async () => {
    const [pending] =
      await sql`UPDATE social_oauth_requests SET consumed_at=now() WHERE state_hash=${stateHash} AND provider='facebook-pages' AND user_id=${userId} AND expires_at>now() AND consumed_at IS NULL RETURNING workspace_id`;
    if (!pending)
      throw new HTTPException(400, {
        message:
          "This connection request expired or was already used. Start again",
      });
    await checkMetaAuthorization("facebook-pages", subjectId, stateHash);
    await sql`DELETE FROM facebook_page_authorizations WHERE expires_at<=now()`;
    await sql`INSERT INTO facebook_page_authorizations(id,workspace_id,user_id,subject_hash,encrypted_grant) SELECT ${id},${pending.workspaceId},${userId},${metaSubjectHash("facebook-pages", subjectId)},${seal(grantSchema.parse({ credential, pages }), `facebook-pages:${id}`)} FROM social_oauth_requests WHERE state_hash=${stateHash}`;
  });
  return id;
}
export function facebookPageRoutes(listPages = facebookPages) {
  const routes = new Hono<Env>();
  async function pending(id: string, userId: string) {
    const [row] = await sql<
      { encryptedGrant: string; workspaceId: string; subjectHash: string }[]
    >`SELECT encrypted_grant,workspace_id,subject_hash FROM facebook_page_authorizations WHERE id=${id} AND user_id=${userId} AND workspace_id=(SELECT id FROM workspace) AND expires_at>now()`;
    if (!row)
      throw new HTTPException(404, {
        message:
          "This Page selection expired or is unavailable. Connect Facebook Pages again.",
      });
    return {
      ...row,
      ...grantSchema.parse(unseal(row.encryptedGrant, `facebook-pages:${id}`)),
    };
  }
  routes.get("/api/social/facebook-pages/authorizations/:id", async (c) => {
    requireHuman(c);
    const actor = requireRole(c, "admin");
    const value = await pending(
      z.uuid().parse(c.req.param("id")),
      actor.userId,
    );
    return c.json({
      pages: value.pages.map(({ accountId, name, handle, avatarUrl }) => ({
        accountId,
        name,
        handle,
        avatarUrl,
      })),
    });
  });
  routes.post("/api/social/facebook-pages/authorizations/:id", async (c) => {
    requireHuman(c);
    const actor = requireRole(c, "admin");
    const id = z.uuid().parse(c.req.param("id"));
    const { accountIds } = z
      .object({
        accountIds: z
          .array(z.string().regex(/^[0-9]+$/))
          .min(1)
          .max(2000)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            "Choose each Page once",
          ),
      })
      .strict()
      .parse(await c.req.json());
    const value = await pending(id, actor.userId);
    if (
      accountIds.some(
        (accountId) => !value.pages.some((p) => p.accountId === accountId),
      )
    )
      throw new HTTPException(400, {
        message: "Choose only Pages listed in this connection request",
      });
    const credential = await refreshCredentials(
      "facebook-pages",
      value.credential,
    );
    const current = await listPages(credential.accessToken, accountIds);
    const chosen = [...accountIds]
      .sort()
      .map((accountId) => current.find((p) => p.accountId === accountId));
    if (chosen.some((p) => !p))
      throw new HTTPException(403, {
        message: "Your Page access changed. Connect Facebook Pages again.",
      });
    await withMutationAuthority(c, async () => {
      const [grant] =
        await sql`DELETE FROM facebook_page_authorizations WHERE id=${id} AND user_id=${actor.userId} AND workspace_id=${value.workspaceId} AND expires_at>now() RETURNING id`;
      if (!grant)
        throw new HTTPException(409, {
          message:
            "This Page selection was already completed, revoked or expired",
        });
      for (const page of chosen) {
        if (!page) continue;
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${value.workspaceId}:facebook-pages:${page.accountId}`},0))`;
        const [existing] = await sql<
          { id: string }[]
        >`SELECT id FROM social_connections WHERE workspace_id=${value.workspaceId} AND provider='facebook-pages' AND account_id=${page.accountId}`;
        const connectionId = existing?.id ?? randomUUID();
        const encrypted = seal(
          { ...credential, accessToken: page.accessToken },
          `social-connection:${connectionId}`,
        );
        await sql`INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,avatar_url,encrypted_credentials,connected_by,facebook_subject_hash) VALUES(${connectionId},${value.workspaceId},'facebook-pages',${page.accountId},${page.name},${page.handle},${page.avatarUrl},${encrypted},${actor.userId},${value.subjectHash}) ON CONFLICT(workspace_id,provider,account_id) DO UPDATE SET name=excluded.name,handle=excluded.handle,avatar_url=excluded.avatar_url,encrypted_credentials=excluded.encrypted_credentials,state='connected',connected_by=excluded.connected_by,facebook_subject_hash=excluded.facebook_subject_hash,updated_at=now()`;
      }
    });
    return c.json({ connected: chosen.length });
  });
  routes.delete("/api/social/facebook-pages/authorizations/:id", async (c) => {
    requireHuman(c);
    const actor = requireRole(c, "admin");
    const id = z.uuid().parse(c.req.param("id"));
    await sql`DELETE FROM facebook_page_authorizations WHERE id=${id} AND user_id=${actor.userId}`;
    return c.json({ cancelled: true });
  });
  return routes;
}
