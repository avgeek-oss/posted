import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  sql,
  withDatabaseTransaction,
} from "../../../../packages/database/src/index.js";
import type { LinkedInPage } from "../../../../packages/contracts/src/index.js";
import { requireHuman, requireRole, type Env } from "../http.js";
import { bearer, providerJson } from "./network.js";
import { seal, unseal } from "./secrets.js";
import {
  credentialsSchema,
  refreshCredentials,
  type SocialCredentials,
} from "./tokens.js";

export const linkedinHeaders = (token: string) => ({
  ...bearer(token),
  "LinkedIn-Version": "202609",
  "X-Restli-Protocol-Version": "2.0.0",
});
const pageSchema = z.object({
  accountId: z.string().regex(/^[0-9]+$/),
  name: z.string().min(1),
  handle: z.string().min(1),
  avatarUrl: z.url().nullable(),
});
const grantSchema = z.object({
  credential: credentialsSchema,
  pages: z.array(pageSchema),
});
const aclSchema = z.object({
  elements: z.array(
    z.object({
      organization: z.string().optional(),
      organizationTarget: z.string().optional(),
      role: z.string(),
      state: z.string(),
    }),
  ),
  paging: z.object({
    start: z.number().int().nonnegative(),
    count: z.number().int().positive().max(1000).optional(),
    total: z.number().int().nonnegative().optional(),
  }),
});
export async function linkedInPages(
  accessToken: string,
): Promise<LinkedInPage[]> {
  const headers = linkedinHeaders(accessToken);
  const ids = new Set<string>();
  for (let start = 0; ;) {
    if (start >= 2000)
      throw new HTTPException(400, {
        message: "Too many LinkedIn Pages to load. Contact your operator.",
      });
    const url = new URL("https://api.linkedin.com/rest/organizationAcls");
    url.search = new URLSearchParams({
      q: "roleAssignee",
      state: "APPROVED",
      count: "100",
      start: String(start),
    }).toString();
    const result = await providerJson(url, aclSchema, { headers });
    if (result.paging.start !== start)
      throw new Error("LinkedIn returned an unexpected Page cursor");
    for (const entry of result.elements) {
      if (
        entry.state !== "APPROVED" ||
        !["ADMINISTRATOR", "CONTENT_ADMINISTRATOR", "CONTENT_ADMIN"].includes(
          entry.role,
        )
      )
        continue;
      const id = (entry.organizationTarget ?? entry.organization)?.match(
        /^urn:li:organization:([0-9]+)$/,
      )?.[1];
      if (id) ids.add(id);
    }
    const count = result.paging.count ?? 100;
    if (
      result.elements.length < count ||
      (result.paging.total !== undefined &&
        start + count >= result.paging.total)
    )
      break;
    start += count;
  }
  const pages: LinkedInPage[] = [];
  const values = [...ids];
  for (let start = 0; start < values.length; start += 5) {
    pages.push(
      ...(await Promise.all(
        values.slice(start, start + 5).map(async (id) => {
          const url = new URL(
            `https://api.linkedin.com/rest/organizations/${id}`,
          );
          url.searchParams.set(
            "projection",
            "(id,localizedName,vanityName,logoV2(original~:playableStreams))",
          );
          const page = await providerJson(
            url,
            z.object({
              id: z.number().int().positive(),
              localizedName: z.string().min(1),
              vanityName: z.string().optional(),
              logoV2: z
                .object({
                  "original~": z
                    .object({
                      elements: z.array(
                        z.object({
                          identifiers: z.array(
                            z.object({ identifier: z.url() }),
                          ),
                        }),
                      ),
                    })
                    .optional(),
                })
                .optional(),
            }),
            { headers },
          );
          if (String(page.id) !== id)
            throw new Error("LinkedIn returned an unexpected Page identity");
          const images =
            page.logoV2?.["original~"]?.elements.flatMap((element) =>
              element.identifiers.map((item) => item.identifier),
            ) ?? [];
          return {
            accountId: id,
            name: page.localizedName,
            handle: page.vanityName || id,
            avatarUrl:
              images
                .filter((image) => new URL(image).protocol === "https:")
                .at(-1) ?? null,
          };
        }),
      )),
    );
  }
  return pages;
}
export async function saveLinkedInPageGrant(
  userId: string,
  stateHash: string,
  credential: SocialCredentials,
  pages: LinkedInPage[],
) {
  const id = randomUUID();
  await withDatabaseTransaction(async () => {
    const [pending] = await sql<
      { workspaceId: string }[]
    >`UPDATE social_oauth_requests SET consumed_at=now() WHERE state_hash=${stateHash} AND provider='linkedin-pages' AND user_id=${userId} AND expires_at>now() AND consumed_at IS NULL RETURNING workspace_id`;
    if (!pending)
      throw new HTTPException(400, {
        message:
          "This connection request expired or was already used. Start again",
      });
    await sql`DELETE FROM linkedin_page_authorizations WHERE expires_at<=now()`;
    await sql`INSERT INTO linkedin_page_authorizations(id,workspace_id,user_id,encrypted_grant) VALUES(${id},${pending.workspaceId},${userId},${seal(grantSchema.parse({ credential, pages }), `linkedin-pages:${id}`)})`;
  });
  return id;
}
export function linkedInPageRoutes(listPages = linkedInPages) {
  const routes = new Hono<Env>();
  async function pending(id: string, userId: string) {
    const [row] = await sql<
      { encryptedGrant: string; workspaceId: string }[]
    >`SELECT encrypted_grant,workspace_id FROM linkedin_page_authorizations WHERE id=${id} AND user_id=${userId} AND workspace_id=(SELECT id FROM workspace) AND expires_at>now()`;
    if (!row)
      throw new HTTPException(404, {
        message:
          "This Page selection expired or is unavailable. Connect LinkedIn Pages again.",
      });
    return {
      ...row,
      ...grantSchema.parse(unseal(row.encryptedGrant, `linkedin-pages:${id}`)),
    };
  }
  routes.get("/api/social/linkedin-pages/authorizations/:id", async (c) => {
    requireHuman(c);
    const actor = requireRole(c, "admin");
    const value = await pending(
      z.uuid().parse(c.req.param("id")),
      actor.userId,
    );
    return c.json({ pages: value.pages });
  });
  routes.post("/api/social/linkedin-pages/authorizations/:id", async (c) => {
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
        (id) => !value.pages.some((page) => page.accountId === id),
      )
    )
      throw new HTTPException(400, {
        message: "Choose only Pages listed in this connection request",
      });
    const credential = await refreshCredentials(
      "linkedin-pages",
      value.credential,
    );
    const current = await listPages(credential.accessToken);
    const chosen = [...accountIds]
      .sort()
      .map((id) => current.find((page) => page.accountId === id));
    if (chosen.some((page) => !page))
      throw new HTTPException(403, {
        message: "Your Page access changed. Connect LinkedIn Pages again.",
      });
    await withDatabaseTransaction(async () => {
      const [grant] =
        await sql`DELETE FROM linkedin_page_authorizations WHERE id=${id} AND user_id=${actor.userId} AND expires_at>now() RETURNING id`;
      if (!grant)
        throw new HTTPException(409, {
          message: "This Page selection was already completed or expired",
        });
      for (const page of chosen) {
        if (!page) continue;
        // Lock an existing identity before sealing credentials to its connection ID.
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${value.workspaceId}:linkedin-pages:${page.accountId}`},0))`;
        const [existing] = await sql<
          { id: string }[]
        >`SELECT id FROM social_connections WHERE workspace_id=${value.workspaceId} AND provider='linkedin-pages' AND account_id=${page.accountId}`;
        const connectionId = existing?.id ?? randomUUID();
        const encrypted = seal(credential, `social-connection:${connectionId}`);
        await sql`INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,avatar_url,encrypted_credentials,connected_by) VALUES(${connectionId},${value.workspaceId},'linkedin-pages',${page.accountId},${page.name},${page.handle},${page.avatarUrl},${encrypted},${actor.userId}) ON CONFLICT(workspace_id,provider,account_id) DO UPDATE SET name=excluded.name,handle=excluded.handle,avatar_url=excluded.avatar_url,encrypted_credentials=excluded.encrypted_credentials,state='connected',connected_by=excluded.connected_by,updated_at=now()`;
      }
    });
    return c.json({ connected: chosen.length });
  });
  routes.delete("/api/social/linkedin-pages/authorizations/:id", async (c) => {
    requireHuman(c);
    const actor = requireRole(c, "admin");
    const id = z.uuid().parse(c.req.param("id"));
    await sql`DELETE FROM linkedin_page_authorizations WHERE id=${id} AND user_id=${actor.userId}`;
    return c.json({ cancelled: true });
  });
  return routes;
}
