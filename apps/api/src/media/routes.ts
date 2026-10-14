import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { sql } from "../../../../packages/database/src/index.js";
import { requireRole, type Env } from "../http.js";
import {
  mediaBytes,
  mediaUrl,
  storageConfigured,
  storeOriginal,
  uploadUrl,
} from "./storage.js";

import { videoUploadBytes } from "../../../../packages/contracts/src/media.js";

import { mediaTypes, uploadInput } from "./input.js";

export const mediaRoutes = new Hono<Env>();
mediaRoutes.get("/media/config", (c) => {
  requireRole(c);
  return c.json({
    enabled: storageConfigured(),
    maxBytes: videoUploadBytes,
    maxImageBytes: 20 * 1024 * 1024,
    contentTypes: mediaTypes,
  });
});
mediaRoutes.post("/media/uploads", async (c) => {
  const actor = requireRole(c, "member");
  if (!storageConfigured())
    throw new HTTPException(503, {
      message: "Ask an administrator to configure media storage",
    });
  const input = uploadInput.parse(await c.req.json());
  if (
    !input.contentType.startsWith("video/") &&
    input.sizeBytes > 20 * 1024 * 1024
  )
    throw new HTTPException(400, {
      message: "Images must be 20 MB or smaller",
    });
  const id = randomUUID();
  const objectKey = `posted/uploads/${id}`;
  const [image] =
    await sql`INSERT INTO post_media(id,workspace_id,created_by,object_key,file_name,content_type,size_bytes,alt) VALUES(${id},(SELECT id FROM workspace),${actor.userId},${objectKey},${input.fileName},${input.contentType},${input.sizeBytes},${input.alt}) RETURNING id`;
  return c.json(
    {
      mediaId: image.id,
      uploadUrl: await uploadUrl(objectKey, input.contentType, input.sizeBytes),
      headers: { "Content-Type": input.contentType },
    },
    201,
  );
});
mediaRoutes.post("/media/:id/complete", async (c) => {
  requireRole(c, "member");
  const id = z.uuid().parse(c.req.param("id"));
  const [image] = await sql<
    {
      objectKey: string;
      sizeBytes: number;
      contentType: string;
      state: string;
    }[]
  >`SELECT object_key,size_bytes,content_type,state FROM post_media WHERE id=${id} AND workspace_id=(SELECT id FROM workspace)`;
  if (!image || image.state === "deleted")
    throw new HTTPException(404, { message: "This media does not exist" });
  if (image.state === "processing") return c.json({ state: "processing" }, 202);
  if (image.state === "failed")
    throw new HTTPException(422, {
      message:
        "This video could not be prepared. Upload it again in a supported format.",
    });
  if (image.state !== "ready") {
    const bytes = await mediaBytes(
      image.objectKey,
      image.contentType.startsWith("video/")
        ? videoUploadBytes
        : 20 * 1024 * 1024,
    );
    const detected = await fileTypeFromBuffer(bytes);
    if (
      bytes.length !== image.sizeBytes ||
      detected?.mime !== image.contentType
    )
      throw new HTTPException(400, {
        message:
          "The uploaded bytes don't match this media's file type or size",
      });
    const originalKey = `posted/originals/${id}/${randomUUID()}`;
    if (image.contentType.startsWith("video/")) {
      await storeOriginal(originalKey, bytes, image.contentType);
      await sql`UPDATE post_media SET state='processing',original_object_key=${originalKey},object_key=${originalKey} WHERE id=${id} AND state='uploading'`;
      return c.json({ state: "processing" }, 202);
    } else {
      const decoder = sharp(bytes, { limitInputPixels: 40_000_000 });
      const info = await decoder.metadata();
      await decoder.stats();
      if (!info.width || !info.height || (info.pages ?? 1) > 1)
        throw new HTTPException(400, {
          message: "Upload a still image with valid dimensions",
        });
      await storeOriginal(originalKey, bytes, image.contentType);
      await sql`UPDATE post_media SET state='ready',object_key=${originalKey},width=${info.width},height=${info.height} WHERE id=${id}`;
    }
  }
  const [ready] =
    await sql`SELECT id,file_name,content_type,size_bytes,width,height,alt,duration_seconds FROM post_media WHERE id=${id}`;
  return c.json({ state: "ready", media: ready });
});
mediaRoutes.get("/media/:id/status", async (c) => {
  requireRole(c);
  const id = z.uuid().parse(c.req.param("id"));
  const [media] =
    await sql`SELECT id,file_name,content_type,size_bytes,width,height,alt,duration_seconds,state FROM post_media WHERE id=${id} AND workspace_id=(SELECT id FROM workspace) AND state<>'deleted'`;
  if (!media)
    throw new HTTPException(404, { message: "This media does not exist" });
  if (media.state === "failed")
    throw new HTTPException(422, {
      message:
        "This video could not be prepared. Use a valid MP4 or MOV between 3 seconds and 30 minutes.",
    });
  const { state, ...ready } = media;
  return c.json(state === "ready" ? { state, media: ready } : { state });
});
mediaRoutes.get("/media/:id/preview", async (c) => {
  requireRole(c);
  const id = z.uuid().parse(c.req.param("id"));
  const [image] = await sql<
    { objectKey: string }[]
  >`SELECT object_key FROM post_media WHERE id=${id} AND state='ready' AND workspace_id=(SELECT id FROM workspace)`;
  if (!image)
    throw new HTTPException(404, { message: "This media does not exist" });
  return c.json({ url: await mediaUrl(image.objectKey) });
});
