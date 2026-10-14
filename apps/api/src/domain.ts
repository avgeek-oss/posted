import { createHash } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  sql,
  withDatabaseTransaction,
} from "../../../packages/database/src/index.js";
import { requireRole, conflict, type Env } from "./http.js";
import {
  contentHash,
  postInput,
  validateProviderContent,
} from "./posts/input.js";
import { postState } from "./posts/state.js";
import { draftRoutes } from "./posts/drafts.js";
import { enabledProviders } from "./social/capabilities.js";
import type {
  Post,
  PostDelivery,
  PostMedia,
  SocialConnection,
} from "../../../packages/contracts/src/index.js";

import {
  isVideo,
  mediaForProvider,
  mediaError,
} from "../../../packages/contracts/src/media.js";

export const domainRoutes = new Hono<Env>();
domainRoutes.route("/", draftRoutes);
const uuid = z.uuid();
type Group = Omit<Post, "state" | "deliveries" | "media" | "managedBy"> & {
  managerId: string | null;
  managerName: string | null;
  managerEmail: string | null;
};
async function readPost(id: string): Promise<Post> {
  const [record] = await sql<
    Group[]
  >`SELECT g.id,g.text,g.scheduled_at,g.idempotency_key,g.version,g.created_at,u.id AS manager_id,u.name AS manager_name,u.email AS manager_email FROM post_groups g LEFT JOIN users u ON u.id=g.last_edited_by WHERE g.id=${id}`;
  if (!record)
    throw new HTTPException(404, { message: "This post does not exist" });
  const { managerId, managerName, managerEmail, ...post } = record;
  const deliveries = await sql<
    PostDelivery[]
  >`SELECT d.id,d.connection_id,c.provider,c.name AS account_name,d.text_override,d.state,d.provider_post_id,d.published_url,d.error,d.published_at FROM post_deliveries d JOIN social_connections c ON c.id=d.connection_id WHERE d.group_id=${id} ORDER BY d.created_at,d.id`;
  const images = await sql<
    PostMedia[]
  >`SELECT i.id,i.file_name,i.content_type,i.size_bytes,i.width,i.height,i.alt,i.duration_seconds FROM post_group_media gi JOIN post_media i ON i.id=gi.media_id WHERE gi.group_id=${id} ORDER BY gi.position`;
  return {
    ...post,
    managedBy:
      managerId && managerName && managerEmail
        ? {
            id: managerId,
            name: managerName,
            avatarUrl: `https://www.gravatar.com/avatar/${createHash("sha256").update(managerEmail.trim().toLowerCase()).digest("hex")}?s=160&d=404&r=g`,
          }
        : null,
    state: postState(deliveries.map((item) => item.state)),
    deliveries,
    media: images,
  };
}
async function validateTargets(
  workspaceId: string,
  input: z.infer<typeof postInput>,
) {
  const connections = await sql<
    SocialConnection[]
  >`SELECT id,provider,state FROM social_connections WHERE id=ANY(${input.connectionIds}::uuid[]) AND workspace_id=${workspaceId} FOR SHARE`;
  if (
    connections.length !== input.connectionIds.length ||
    connections.some((item) => item.state !== "connected")
  )
    throw new HTTPException(400, {
      message: "Select connected accounts belonging to this team",
    });
  const images = await sql<
    PostMedia[]
  >`SELECT id,content_type,duration_seconds FROM post_media WHERE id=ANY(${input.mediaIds}::uuid[]) AND workspace_id=${workspaceId} AND state='ready' FOR SHARE`;
  if (images.length !== input.mediaIds.length)
    throw new HTTPException(400, {
      message: "Wait for this team's media to finish uploading",
    });
  const ordered = images.sort(
    (left, right) =>
      input.mediaIds.indexOf(left.id) - input.mediaIds.indexOf(right.id),
  );
  for (const connection of connections) {
    try {
      const error = mediaError(connection.provider, ordered);
      if (error) throw new Error(error);
      validateProviderContent(
        connection.provider,
        input.textOverrides[connection.id] ?? input.text,
        mediaForProvider(connection.provider, ordered).filter(
          (item) => !isVideo(item),
        ).length,
      );
    } catch (error) {
      throw new HTTPException(400, {
        message:
          error instanceof Error ? error.message : "Check this post's content",
      });
    }
  }
}
async function saveTargets(
  id: string,
  workspaceId: string,
  input: z.infer<typeof postInput>,
) {
  for (const connectionId of input.connectionIds)
    await sql`INSERT INTO post_deliveries(group_id,workspace_id,connection_id,available_at,text_override) VALUES(${id},${workspaceId},${connectionId},${input.scheduledAt},${input.textOverrides[connectionId] ?? null})`;
  for (let position = 0; position < input.mediaIds.length; position++)
    await sql`INSERT INTO post_group_media(group_id,media_id,workspace_id,position) VALUES(${id},${input.mediaIds[position]},${workspaceId},${position})`;
}

domainRoutes.get("/providers", (c) => {
  requireRole(c);
  return c.json({ providers: enabledProviders(process.env) });
});
domainRoutes.get("/connections", async (c) => {
  requireRole(c);
  const items = await sql<
    SocialConnection[]
  >`SELECT id,provider,account_id,name,handle,avatar_url,state,created_at FROM social_connections WHERE workspace_id=(SELECT id FROM workspace) AND state<>'disconnected' ORDER BY provider,lower(name),id`;
  return c.json({ items });
});
domainRoutes.delete("/connections/:id", async (c) => {
  requireRole(c, "admin");
  const id = uuid.parse(c.req.param("id"));
  const [connection] = await sql<
    { provider: string; accountId: string }[]
  >`SELECT provider,account_id FROM social_connections WHERE id=${id} AND workspace_id=(SELECT id FROM workspace)`;
  if (!connection)
    throw new HTTPException(404, { message: "This account does not exist" });
  if (connection.provider === "bluesky") {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bluesky:${connection.accountId}`},0))`;
    await sql`DELETE FROM bluesky_oauth_sessions WHERE key=${connection.accountId}`;
  }
  await sql`UPDATE social_connections SET state='disconnected',encrypted_credentials='',updated_at=now() WHERE id=${id}`;
  await sql`UPDATE post_deliveries SET state='failed',error='This account was disconnected before publishing',updated_at=now() WHERE connection_id=${id} AND state='scheduled'`;
  return c.json({ completed: true });
});
domainRoutes.get("/posts/counts", async (c) => {
  requireRole(c);
  const [counts] = await sql<{ scheduled: number; drafts: number }[]>`
    SELECT
      (SELECT count(*)::int FROM post_groups g WHERE g.workspace_id=(SELECT id FROM workspace) AND EXISTS(SELECT 1 FROM post_deliveries d WHERE d.group_id=g.id AND d.state IN ('scheduled','preparing','publishing'))) AS scheduled,
      (SELECT count(*)::int FROM post_drafts WHERE workspace_id=(SELECT id FROM workspace) AND published_post_id IS NULL) AS drafts`;
  return c.json(counts);
});
domainRoutes.get("/posts", async (c) => {
  requireRole(c);
  const query = z
    .object({
      view: z.enum(["scheduled", "history"]).default("scheduled"),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    })
    .parse(c.req.query());
  const active = sql`EXISTS(SELECT 1 FROM post_deliveries d WHERE d.group_id=g.id AND d.state IN ('scheduled','preparing','publishing'))`;
  const condition = query.view === "scheduled" ? active : sql`NOT ${active}`;
  const [total] = await sql<
    { count: number }[]
  >`SELECT count(*)::int AS count FROM post_groups g WHERE ${condition}`;
  const page = Math.min(
    query.page,
    Math.max(1, Math.ceil(total.count / query.pageSize)),
  );
  const groups = await sql<
    { id: string }[]
  >`SELECT g.id FROM post_groups g WHERE ${condition} ORDER BY g.scheduled_at DESC,g.id DESC LIMIT ${query.pageSize} OFFSET ${(page - 1) * query.pageSize}`;
  return c.json({
    items: await Promise.all(groups.map((group) => readPost(group.id))),
    total: total.count,
    page,
    pageSize: query.pageSize,
  });
});
domainRoutes.get("/posts/:id", async (c) => {
  requireRole(c);
  return c.json({ post: await readPost(uuid.parse(c.req.param("id"))) });
});
domainRoutes.post("/posts", async (c) => {
  const actor = requireRole(c, "member");
  const input = postInput.parse(await c.req.json());
  const hash = contentHash(input);
  return withDatabaseTransaction(async () => {
    const tx = sql;
    const [team] = await tx<
      { id: string }[]
    >`SELECT id FROM workspace FOR UPDATE`;
    const [existing] = await tx<
      { id: string; requestHash: string }[]
    >`SELECT id,request_hash FROM post_groups WHERE workspace_id=${team.id} AND idempotency_key=${input.idempotencyKey}`;
    if (existing) {
      if (existing.requestHash !== hash)
        conflict("This request key was already used for different content");
      c.header("Idempotency-Replayed", "true");
      return c.json({ post: await readPost(existing.id) });
    }
    if (new Date(input.scheduledAt).getTime() < Date.now() - 60_000)
      throw new HTTPException(400, {
        message: "Choose now or a future time for this post",
      });
    await validateTargets(team.id, input);
    if (input.draftSource) {
      const [draft] = await tx<
        { version: number; publishedPostId: string | null }[]
      >`SELECT version,published_post_id FROM post_drafts WHERE id=${input.draftSource.id} AND workspace_id=${team.id} FOR UPDATE`;
      if (
        !draft ||
        draft.version !== input.draftSource.version ||
        draft.publishedPostId
      )
        conflict(
          "This draft changed or was already posted. Reload it before trying again",
        );
    }
    const [group] = await tx<
      { id: string }[]
    >`INSERT INTO post_groups(workspace_id,created_by,last_edited_by,text,scheduled_at,idempotency_key,request_hash) VALUES(${team.id},${actor.userId},${actor.userId},${input.text},${input.scheduledAt},${input.idempotencyKey},${hash}) RETURNING id`;
    await saveTargets(group.id, team.id, input);
    if (input.draftSource)
      await tx`UPDATE post_drafts SET published_post_id=${group.id},updated_at=now() WHERE id=${input.draftSource.id}`;
    return c.json({ post: await readPost(group.id) }, 201);
  });
});
domainRoutes.patch("/posts/:id", async (c) => {
  const actor = requireRole(c, "member");
  const id = uuid.parse(c.req.param("id"));
  const input = postInput
    .safeExtend({ version: z.number().int().positive() })
    .parse(await c.req.json());
  return withDatabaseTransaction(async () => {
    const tx = sql;
    const [team] = await tx<
      { id: string }[]
    >`SELECT id FROM workspace FOR UPDATE`;
    const hash = contentHash(input);
    const [replay] = await tx<
      { groupId: string; requestHash: string }[]
    >`SELECT group_id,request_hash FROM post_edit_requests WHERE workspace_id=${team.id} AND idempotency_key=${input.idempotencyKey}`;
    if (replay) {
      if (replay.groupId !== id || replay.requestHash !== hash)
        conflict(
          "This edit request key was already used for different content",
        );
      c.header("Idempotency-Replayed", "true");
      return c.json({ post: await readPost(id) });
    }
    if (new Date(input.scheduledAt).getTime() < Date.now())
      throw new HTTPException(400, {
        message: "Choose a future time for this scheduled post",
      });
    const [group] = await tx<
      { workspaceId: string; version: number; cancelledAt: Date | null }[]
    >`SELECT workspace_id,version,cancelled_at FROM post_groups WHERE id=${id} FOR UPDATE`;
    if (!group)
      throw new HTTPException(404, { message: "This post does not exist" });
    const states = await tx<
      { state: string }[]
    >`SELECT state FROM post_deliveries WHERE group_id=${id} FOR UPDATE`;
    if (group.version !== input.version) conflict();
    if (group.cancelledAt || states.some((item) => item.state !== "scheduled"))
      conflict("This post has started publishing and can no longer be edited");
    await validateTargets(group.workspaceId, input);
    await tx`DELETE FROM post_deliveries WHERE group_id=${id}`;
    await tx`DELETE FROM post_group_media WHERE group_id=${id}`;
    await tx`UPDATE post_groups SET text=${input.text},scheduled_at=${input.scheduledAt},last_edited_by=${actor.userId},version=version+1,updated_at=now() WHERE id=${id}`;
    await saveTargets(id, group.workspaceId, input);
    await tx`INSERT INTO post_edit_requests(workspace_id,idempotency_key,group_id,request_hash) VALUES(${team.id},${input.idempotencyKey},${id},${hash})`;
    return c.json({ post: await readPost(id) });
  });
});
domainRoutes.delete("/posts/:id", async (c) => {
  const actor = requireRole(c, "member");
  const id = uuid.parse(c.req.param("id"));
  return withDatabaseTransaction(async () => {
    const tx = sql;
    const [group] =
      await tx`SELECT id,cancelled_at FROM post_groups WHERE id=${id} FOR UPDATE`;
    if (!group)
      throw new HTTPException(404, { message: "This post does not exist" });
    if (group.cancelledAt) return c.json({ post: await readPost(id) });
    const deliveries = await tx<
      { state: string }[]
    >`SELECT state FROM post_deliveries WHERE group_id=${id} FOR UPDATE`;
    if (
      deliveries.some(
        (item) => item.state === "preparing" || item.state === "publishing",
      )
    )
      conflict("This post is publishing and can no longer be cancelled");
    await tx`UPDATE post_groups SET cancelled_at=now(),last_edited_by=${actor.userId},updated_at=now(),version=version+1 WHERE id=${id}`;
    await tx`UPDATE post_deliveries SET state='cancelled' WHERE group_id=${id} AND state='scheduled'`;
    return c.json({ post: await readPost(id) });
  });
});
domainRoutes.get("/workspace", async (c) => {
  requireRole(c);
  const [workspace] = await sql`SELECT id,name,created_at FROM workspace`;
  return c.json({ workspace });
});
domainRoutes.patch("/workspace", async (c) => {
  requireRole(c, "admin");
  const { name } = z
    .object({ name: z.string().trim().min(1).max(120) })
    .parse(await c.req.json());
  const [workspace] =
    await sql`UPDATE workspace SET name=${name} RETURNING id,name,created_at`;
  return c.json({ workspace });
});
