import {
  sql,
  withDatabaseTransaction,
} from "../../../packages/database/src/index.js";
import {
  claimDelivery,
  completeDelivery,
  failDelivery,
  publishingBoundary,
  renewLease,
  type DeliveryJob,
} from "../../api/src/posts/queue.js";
import { prepareImage } from "../../api/src/media/prepare.js";
import { mediaBytes, preparedMediaUrl } from "../../api/src/media/storage.js";
import {
  credentialsSchema,
  refreshCredentials,
} from "../../api/src/social/tokens.js";
import { seal, unseal } from "../../api/src/social/secrets.js";
import {
  preparePublication,
  type DeliveryMedia,
} from "../../api/src/social/publish.js";
import {
  ProviderFailure,
  temporaryFailure,
} from "../../api/src/social/network.js";
import { validateProviderContent } from "../../api/src/posts/input.js";
import {
  isVideo,
  mediaForProvider,
  mediaError,
  videoUploadBytes,
} from "../../../packages/contracts/src/media.js";

async function accessToken(job: DeliveryJob) {
  if (job.provider === "bluesky") return undefined;
  return withDatabaseTransaction(async () => {
    const [connection] = await sql<
      { encryptedCredentials: string; state: string }[]
    >`SELECT encrypted_credentials,state FROM social_connections WHERE id=${job.connectionId} FOR UPDATE`;
    if (!connection || connection.state !== "connected")
      throw new Error("This account is no longer connected");
    const current = credentialsSchema.parse(
      unseal(
        connection.encryptedCredentials,
        `social-connection:${job.connectionId}`,
      ),
    );
    const next = await refreshCredentials(
      job.provider as "x" | "linkedin" | "threads",
      current,
    );
    if (next !== current)
      await sql`UPDATE social_connections SET encrypted_credentials=${seal(next, `social-connection:${job.connectionId}`)},updated_at=now() WHERE id=${job.connectionId}`;
    return next.accessToken;
  });
}
export async function deliverNext(): Promise<boolean> {
  const job = await claimDelivery();
  if (!job) return false;
  let publishing = false;
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    renewLease(job)
      .then((ok) => {
        if (!ok) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, 30_000);
  try {
    const uploaded = await sql<
      {
        id: string;
        objectKey: string;
        alt: string;
        contentType: string;
        width: number;
        height: number;
        durationSeconds: number | null;
      }[]
    >`SELECT i.id,i.object_key,i.alt,i.content_type,i.width,i.height,i.duration_seconds FROM (
      SELECT media_id,position FROM post_group_account_media WHERE group_id=${job.groupId} AND post_index=${job.postIndex ?? 0} AND connection_id=${job.connectionId}
      UNION ALL
      SELECT media_id,position FROM post_group_media WHERE group_id=${job.groupId} AND post_index=${job.postIndex ?? 0}
        AND NOT EXISTS(SELECT 1 FROM post_group_media_overrides WHERE group_id=${job.groupId} AND post_index=${job.postIndex ?? 0} AND connection_id=${job.connectionId})
    ) gi JOIN post_media i ON i.id=gi.media_id WHERE i.state='ready' ORDER BY gi.position`;
    const error = mediaError(job.provider, uploaded);
    if (error) throw new Error(error);
    const originals = mediaForProvider(job.provider, uploaded);
    validateProviderContent(
      job.provider,
      job.text,
      originals.filter((item) => !isVideo(item)).length,
    );
    const token = await accessToken(job);
    const images: DeliveryMedia[] = [];
    for (const image of originals) {
      if (isVideo(image)) {
        if (image.durationSeconds === null)
          throw new Error("This video has not been prepared");
        const bytes = await mediaBytes(image.objectKey, videoUploadBytes);
        const url =
          job.provider === "threads"
            ? await preparedMediaUrl(
                `posted/delivery/${job.id}/${job.leaseToken}/${image.id}.mp4`,
                bytes,
                "video/mp4",
              )
            : undefined;
        images.push({
          kind: "video",
          id: image.id,
          bytes,
          width: image.width,
          height: image.height,
          durationSeconds: image.durationSeconds,
          alt: image.alt,
          url,
        });
        continue;
      }
      const prepared = await prepareImage(
        await mediaBytes(image.objectKey),
        job.provider,
      );
      const url =
        job.provider === "threads"
          ? await preparedMediaUrl(
              `posted/delivery/${job.id}/${job.leaseToken}/${image.id}.jpg`,
              prepared.bytes,
            )
          : undefined;
      images.push({ ...prepared, id: image.id, alt: image.alt, url });
    }
    const prepared = await preparePublication(job, images, token);
    await sql`UPDATE post_deliveries SET provider_checkpoint=${sql.json(prepared.checkpoint)},updated_at=now() WHERE id=${job.id} AND lease_token=${job.leaseToken} AND state='preparing'`;
    if (leaseLost || !(await publishingBoundary(job)))
      throw new Error(
        "This delivery changed while its media was being prepared",
      );
    publishing = true;
    const result = await prepared.publish();
    await completeDelivery(job, result);
  } catch (error) {
    const message =
      error instanceof ProviderFailure
        ? error.message
        : publishing
          ? "The publishing result could not be confirmed. Check the account before trying again"
          : "This post could not be prepared. Check the connection and media files before trying again";
    if (error instanceof ProviderFailure && [401, 403].includes(error.status))
      await sql`UPDATE social_connections SET state='reauthentication_required' WHERE id=${job.connectionId} AND state='connected'`;
    await failDelivery(
      job,
      message,
      publishing && (!(error instanceof ProviderFailure) || error.uncertain),
      temporaryFailure(error)
        ? {
            retryAfterMs:
              error instanceof ProviderFailure ? error.retryAfterMs : 0,
          }
        : undefined,
    );
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
