import { randomUUID } from "node:crypto";
import {
  sql,
  withDatabaseTransaction,
} from "../../../packages/database/src/index.js";
import { normalizeVideo } from "../../api/src/media/video.js";
import { normalizeGif } from "../../api/src/media/gif.js";
import { mediaBytes, storeOriginal } from "../../api/src/media/storage.js";
import { videoUploadBytes } from "../../../packages/contracts/src/media.js";

export async function prepareNextMedia() {
  const token = randomUUID();
  const media = await withDatabaseTransaction(async () => {
    const [item] = await sql<
      { id: string; objectKey: string; contentType: string }[]
    >`SELECT id,object_key,content_type FROM post_media WHERE state='processing' AND (processing_lease_until IS NULL OR processing_lease_until<now()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (item)
      await sql`UPDATE post_media SET processing_lease_token=${token},processing_lease_until=now()+interval '17 minutes' WHERE id=${item.id}`;
    return item;
  });
  if (!media) return false;
  try {
    const original = await mediaBytes(media.objectKey, videoUploadBytes);
    const prepared =
      media.contentType === "image/gif"
        ? await normalizeGif(original)
        : { ...(await normalizeVideo(original)), thumbnail: null };
    const extension =
      prepared.contentType === "image/gif"
        ? "gif"
        : prepared.contentType === "image/jpeg"
          ? "jpg"
          : "mp4";
    const key = `posted/media/${media.id}/${token}.${extension}`;
    await storeOriginal(key, prepared.bytes, prepared.contentType);
    const thumbnailKey = prepared.thumbnail
      ? `posted/media/${media.id}/${token}.png`
      : null;
    if (thumbnailKey && prepared.thumbnail)
      await storeOriginal(thumbnailKey, prepared.thumbnail, "image/png");
    await sql`UPDATE post_media SET state='ready',object_key=${key},thumbnail_object_key=${thumbnailKey},content_type=${prepared.contentType},size_bytes=${prepared.bytes.length},width=${prepared.width},height=${prepared.height},duration_seconds=${prepared.durationSeconds},processing_lease_token=null,processing_lease_until=null WHERE id=${media.id} AND state='processing' AND processing_lease_token=${token}`;
  } catch {
    await sql`UPDATE post_media SET state='failed',processing_lease_token=null,processing_lease_until=null WHERE id=${media.id} AND state='processing' AND processing_lease_token=${token}`;
  }
  return true;
}
