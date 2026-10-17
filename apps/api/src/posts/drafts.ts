import { createHash } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  sql,
  withDatabaseTransaction,
} from "../../../../packages/database/src/index.js";
import type {
  PostDraft,
  PostMedia,
  SocialConnection,
} from "../../../../packages/contracts/src/index.js";
import {
  allMediaIds,
  canonicalMediaOverrides,
  readAccountMedia,
  saveAccountMedia,
} from "./account-media.js";
import { postPartInput } from "./input.js";
import { requireRole, conflict, type Env } from "../http.js";

const ids = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .refine(
      (values) => new Set(values).size === values.length,
      "Select each item once",
    );
export const draftInput = z
  .object({
    text: z.string().max(64000),
    textOverrides: z.record(z.uuid(), z.string().max(64000)).default({}),
    additionalPosts: z
      .array(
        postPartInput.safeExtend({
          text: z.string().max(64000),
          textOverrides: z.record(z.uuid(), z.string().max(64000)).default({}),
        }),
      )
      .default([]),
    connectionIds: ids(50),
    mediaIds: ids(20),
    mediaOverrides: postPartInput.shape.mediaOverrides,
    version: z.number().int().min(0),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  })
  .strict()
  .refine(
    (value) =>
      [value, ...value.additionalPosts].every((part) =>
        [
          ...Object.keys(part.textOverrides),
          ...Object.keys(part.mediaOverrides),
        ].every((id) => value.connectionIds.includes(id)),
      ),
    "Only selected accounts can have custom text or media",
  );

async function readDraft(id: string): Promise<PostDraft> {
  const [draft] = await sql<
    (Omit<PostDraft, "connections" | "media" | "draftedBy"> & {
      editorId: string | null;
      editorName: string | null;
      editorEmail: string | null;
    })[]
  >`SELECT d.id,d.text,d.additional_posts,d.text_overrides,d.connection_ids,d.version,d.created_at,d.updated_at,u.id AS editor_id,u.name AS editor_name,u.email AS editor_email FROM post_drafts d LEFT JOIN users u ON u.id=d.last_edited_by WHERE d.id=${id} AND d.workspace_id=(SELECT id FROM workspace) AND d.published_post_id IS NULL`;
  if (!draft)
    throw new HTTPException(404, { message: "This draft does not exist" });
  const connections = await sql<
    SocialConnection[]
  >`SELECT id,provider,account_id,name,handle,avatar_url,state,created_at FROM social_connections WHERE id=ANY(${draft.connectionIds}::uuid[]) AND workspace_id=(SELECT id FROM workspace)`;
  const images = await sql<
    (PostMedia & { postIndex: number })[]
  >`SELECT di.post_index,i.id,i.file_name,i.content_type,i.size_bytes,i.width,i.height,i.alt,i.duration_seconds FROM post_draft_media di JOIN post_media i ON i.id=di.media_id WHERE di.draft_id=${id} ORDER BY di.post_index,di.position`;
  const accountMedia = await readAccountMedia("draft", id);
  const { editorId, editorName, editorEmail, ...record } = draft;
  return {
    ...record,
    mediaOverrides: accountMedia.get(0) ?? {},
    connections,
    media: images
      .filter((image) => image.postIndex === 0)
      .map(({ postIndex: _, ...image }) => image),
    additionalPosts: record.additionalPosts.map((part, index) => ({
      ...part,
      mediaOverrides: accountMedia.get(index + 1) ?? {},
      media: images
        .filter((image) => image.postIndex === index + 1)
        .map(({ postIndex: _, ...image }) => image),
    })),
    draftedBy:
      editorId && editorName && editorEmail
        ? {
            id: editorId,
            name: editorName,
            avatarUrl: `https://www.gravatar.com/avatar/${createHash("sha256").update(editorEmail.trim().toLowerCase()).digest("hex")}?s=160&d=404&r=g`,
          }
        : null,
  };
}
export const draftRoutes = new Hono<Env>();
draftRoutes.get("/drafts", async (c) => {
  requireRole(c);
  const query = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    })
    .parse(c.req.query());
  const [total] = await sql<
    { count: number }[]
  >`SELECT count(*)::int AS count FROM post_drafts WHERE workspace_id=(SELECT id FROM workspace) AND published_post_id IS NULL`;
  const page = Math.min(
    query.page,
    Math.max(1, Math.ceil(total.count / query.pageSize)),
  );
  const rows = await sql<
    { id: string }[]
  >`SELECT id FROM post_drafts WHERE workspace_id=(SELECT id FROM workspace) AND published_post_id IS NULL ORDER BY updated_at DESC,id DESC LIMIT ${query.pageSize} OFFSET ${(page - 1) * query.pageSize}`;
  return c.json({
    items: await Promise.all(rows.map((row) => readDraft(row.id))),
    total: total.count,
    page,
    pageSize: query.pageSize,
  });
});
draftRoutes.get("/drafts/:id", async (c) => {
  requireRole(c);
  return c.json({ draft: await readDraft(z.uuid().parse(c.req.param("id"))) });
});
draftRoutes.post("/drafts/:id", async (c) => {
  const actor = requireRole(c, "member");
  const id = z.uuid().parse(c.req.param("id"));
  const input = draftInput.parse(await c.req.json());
  const { additionalPosts, mediaOverrides, ...rootInput } = input;
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        ...rootInput,
        ...(additionalPosts.length
          ? {
              additionalPosts: additionalPosts.map(
                ({ mediaOverrides, ...part }) => ({
                  ...part,
                  ...canonicalMediaOverrides(mediaOverrides),
                  textOverrides: Object.fromEntries(
                    Object.entries(part.textOverrides).sort(([a], [b]) =>
                      a.localeCompare(b),
                    ),
                  ),
                }),
              ),
            }
          : {}),
        textOverrides: Object.fromEntries(
          Object.entries(input.textOverrides).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
        ...canonicalMediaOverrides(mediaOverrides),
        connectionIds: [...input.connectionIds].sort(),
      }),
    )
    .digest("hex");
  return withDatabaseTransaction(async () => {
    const [team] = await sql<
      { id: string }[]
    >`SELECT id FROM workspace FOR UPDATE`;
    const [existing] = await sql<
      {
        workspaceId: string;
        version: number;
        idempotencyKey: string;
        requestHash: string;
        publishedPostId: string | null;
      }[]
    >`SELECT workspace_id,version,idempotency_key,request_hash,published_post_id FROM post_drafts WHERE id=${id} FOR UPDATE`;
    if (existing && existing.workspaceId !== team.id)
      throw new HTTPException(404, { message: "This draft does not exist" });
    if (existing?.publishedPostId)
      conflict("This draft has already been posted or scheduled");
    if (existing?.idempotencyKey === input.idempotencyKey) {
      if (existing.requestHash !== hash)
        conflict("This request key was already used for different content");
      c.header("Idempotency-Replayed", "true");
      return c.json({ draft: await readDraft(id) });
    }
    if ((existing?.version ?? 0) !== input.version)
      conflict("This draft changed. Reload it before saving again");
    const connections =
      await sql`SELECT id FROM social_connections WHERE id=ANY(${input.connectionIds}::uuid[]) AND workspace_id=${team.id} FOR SHARE`;
    if (connections.length !== input.connectionIds.length)
      throw new HTTPException(400, {
        message: "Select accounts belonging to this team",
      });
    const parts = [input, ...input.additionalPosts];
    const mediaIds = allMediaIds(parts);
    const images =
      await sql`SELECT id FROM post_media WHERE id=ANY(${mediaIds}::uuid[]) AND workspace_id=${team.id} AND state='ready' FOR SHARE`;
    if (images.length !== mediaIds.length)
      throw new HTTPException(400, {
        message: "Wait for this team's media to finish uploading",
      });
    await sql`INSERT INTO post_drafts(id,workspace_id,created_by,last_edited_by,text,additional_posts,text_overrides,connection_ids,idempotency_key,request_hash) VALUES(${id},${team.id},${actor.userId},${actor.userId},${input.text},${sql.json(input.additionalPosts.map(({ mediaIds: _, mediaOverrides: _overrides, ...part }) => part))},${sql.json(input.textOverrides)},${input.connectionIds},${input.idempotencyKey},${hash}) ON CONFLICT(id) DO UPDATE SET text=excluded.text,additional_posts=excluded.additional_posts,text_overrides=excluded.text_overrides,connection_ids=excluded.connection_ids,idempotency_key=excluded.idempotency_key,request_hash=excluded.request_hash,last_edited_by=excluded.last_edited_by,version=post_drafts.version+1,updated_at=now()`;
    await sql`DELETE FROM post_draft_media WHERE draft_id=${id}`;
    for (const [postIndex, part] of parts.entries())
      for (let position = 0; position < part.mediaIds.length; position++)
        await sql`INSERT INTO post_draft_media(draft_id,media_id,workspace_id,post_index,position) VALUES(${id},${part.mediaIds[position]},${team.id},${postIndex},${position})`;
    await saveAccountMedia("draft", id, team.id, parts);
    return c.json({ draft: await readDraft(id) }, existing ? 200 : 201);
  });
});
draftRoutes.delete("/drafts/:id", async (c) => {
  requireRole(c, "member");
  const id = z.uuid().parse(c.req.param("id"));
  const input = z
    .object({ version: z.number().int().positive() })
    .strict()
    .parse(await c.req.json());
  const rows =
    await sql`DELETE FROM post_drafts WHERE id=${id} AND workspace_id=(SELECT id FROM workspace) AND published_post_id IS NULL AND version=${input.version} RETURNING id`;
  if (!rows.length)
    conflict(
      "This draft changed or no longer exists. Reload the list before deleting it",
    );
  return c.json({ completed: true });
});
