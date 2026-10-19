import { randomUUID } from "node:crypto";
import { TID } from "@atproto/common-web";
import { isValidTid } from "@atproto/syntax";
import { sql } from "../../../../packages/database/src/index.js";
import type { Provider } from "../../../../packages/contracts/src/index.js";
import { supportsThreads } from "../../../../packages/contracts/src/threads.js";
import {
  deliveryAttemptLimit,
  deliveryRetryDelay,
  retryBaseMilliseconds,
  retryMaximumMilliseconds,
} from "./retry.js";

export type DeliveryJob = {
  id: string;
  groupId: string;
  workspaceId: string;
  connectionId: string;
  leaseToken: string;
  provider: Provider;
  text: string;
  accountId: string;
  encryptedCredentials: string;
  blueskyRecordKey?: string;
  postIndex?: number;
  replyTo?: { id: string; cid: string | null };
  threadRoot?: { id: string; cid: string | null };
};

export async function claimDelivery(): Promise<DeliveryJob | null> {
  return sql.begin(async (tx) => {
    // A crash before publishing is safe to retry. A crash after the publishing boundary isn't.
    await tx`UPDATE post_deliveries SET
      state=CASE WHEN retry_attempts>=${deliveryAttemptLimit} THEN 'failed' ELSE 'scheduled' END,
      available_at=now() + (LEAST(${retryMaximumMilliseconds},${retryBaseMilliseconds} * power(2,LEAST(GREATEST(retry_attempts-1,0),10))) * (1+random()*0.25)) * interval '1 millisecond',
      error='The worker stopped before sending this post. The preparation attempt could not finish.',
      lease_token=NULL,lease_until=NULL,updated_at=now() WHERE state='preparing' AND lease_until<now()`;
    await tx`UPDATE post_deliveries SET state='uncertain',error='The publishing response was not received. Check the connected account before trying again.',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE state='publishing' AND lease_until<now()`;
    await tx`UPDATE post_deliveries d SET state='failed',error='An earlier post in this sequence did not finish publishing. Later posts were not sent.',updated_at=now()
      WHERE d.state='scheduled' AND EXISTS(SELECT 1 FROM post_deliveries earlier WHERE earlier.group_id=d.group_id AND earlier.connection_id=d.connection_id AND earlier.post_index<d.post_index AND earlier.state IN ('failed','uncertain','cancelled'))`;
    const [next] = await tx<{ id: string; groupId: string }[]>`
      SELECT d.id,d.group_id FROM post_deliveries d JOIN post_groups g ON g.id=d.group_id
      WHERE d.state='scheduled' AND d.available_at<=now() AND g.cancelled_at IS NULL
        AND (d.post_index=0 OR EXISTS(SELECT 1 FROM post_deliveries previous WHERE previous.group_id=d.group_id AND previous.connection_id=d.connection_id AND previous.post_index=d.post_index-1 AND previous.state='published'))
      ORDER BY d.available_at,d.created_at,d.post_index FOR UPDATE OF d,g SKIP LOCKED LIMIT 1`;
    if (!next) return null;
    const token = randomUUID();
    const [job] = await tx<DeliveryJob[]>`
      UPDATE post_deliveries d SET state='preparing',lease_token=${token},lease_until=now()+interval '5 minutes',attempts=attempts+1,retry_attempts=retry_attempts+1,updated_at=now()
      FROM post_groups g,social_connections c WHERE d.id=${next.id} AND g.id=d.group_id AND c.id=d.connection_id
      RETURNING d.id,d.group_id,d.post_index,d.workspace_id,d.connection_id,d.lease_token,c.provider,COALESCE(d.text_override,CASE WHEN d.post_index=0 THEN g.text ELSE g.additional_posts->(d.post_index-1)->>'text' END) AS text,c.account_id,c.encrypted_credentials,d.provider_checkpoint->>'rkey' AS bluesky_record_key`;
    if (job?.provider === "bluesky" && !isValidTid(job.blueskyRecordKey)) {
      job.blueskyRecordKey = TID.nextStr();
      await tx`UPDATE post_deliveries SET provider_checkpoint=${tx.json({ rkey: job.blueskyRecordKey })} WHERE id=${job.id}`;
    }
    const postIndex = job?.postIndex ?? 0;
    if (job && postIndex > 0 && supportsThreads(job.provider)) {
      const references = await tx<
        { postIndex: number; id: string; cid: string | null }[]
      >`
        SELECT post_index,provider_post_id AS id,provider_post_cid AS cid
        FROM post_deliveries WHERE group_id=${job.groupId} AND connection_id=${job.connectionId}
          AND post_index IN (0,${postIndex - 1}) AND state='published'`;
      const parent = references.find((ref) => ref.postIndex === postIndex - 1);
      const root = references.find((ref) => ref.postIndex === 0);
      if (!parent?.id || !root?.id)
        throw new Error("Published thread references are missing");
      job.replyTo = parent;
      job.threadRoot = root;
    }
    return job ?? null;
  });
}

export async function publishingBoundary(job: DeliveryJob): Promise<boolean> {
  const rows =
    await sql`UPDATE post_deliveries SET state='publishing',lease_until=now()+interval '5 minutes',updated_at=now()
    WHERE id=${job.id} AND lease_token=${job.leaseToken} AND state='preparing' AND lease_until>now()
      AND EXISTS(SELECT 1 FROM social_connections c WHERE c.id=${job.connectionId} AND c.state='connected') RETURNING id`;
  return rows.length === 1;
}
export async function renewLease(job: DeliveryJob) {
  const rows =
    await sql`UPDATE post_deliveries SET lease_until=now()+interval '5 minutes' WHERE id=${job.id} AND lease_token=${job.leaseToken} AND lease_until>now() AND state IN ('preparing','publishing') RETURNING id`;
  return rows.length === 1;
}
export async function completeDelivery(
  job: DeliveryJob,
  result: { id: string; url: string; cid?: string },
) {
  const rows =
    await sql`UPDATE post_deliveries SET state='published',provider_post_id=${result.id},provider_post_cid=${result.cid ?? null},published_url=${result.url},published_at=now(),lease_token=NULL,lease_until=NULL,error=NULL,updated_at=now()
    WHERE id=${job.id} AND lease_token=${job.leaseToken} AND state='publishing' RETURNING id`;
  if (!rows.length)
    throw new Error(
      "The publishing lease expired before its result could be saved",
    );
}
export async function failDelivery(
  job: DeliveryJob,
  error: string,
  uncertain: boolean,
  retry?: { retryAfterMs: number },
) {
  await sql.begin(async (tx) => {
    const [current] = await tx<
      { retryAttempts: number; retryCancelledAt: Date | null }[]
    >`SELECT retry_attempts,retry_cancelled_at FROM post_deliveries WHERE id=${job.id} AND lease_token=${job.leaseToken} AND state IN ('preparing','publishing') FOR UPDATE`;
    if (!current) return;
    if (retry && !uncertain && !current.retryCancelledAt) {
      if (current.retryAttempts < deliveryAttemptLimit) {
        const delay = deliveryRetryDelay(
          current.retryAttempts,
          retry.retryAfterMs,
        );
        await tx`UPDATE post_deliveries SET state='scheduled',available_at=now()+${delay} * interval '1 millisecond',error=${error},provider_checkpoint=CASE WHEN ${job.provider}='bluesky' THEN provider_checkpoint ELSE NULL END,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${job.id} AND lease_token=${job.leaseToken}`;
        return;
      }
    }
    const rows =
      await tx`UPDATE post_deliveries SET state=${uncertain ? "uncertain" : current.retryCancelledAt ? "cancelled" : "failed"},error=${error},lease_token=NULL,lease_until=NULL,updated_at=now()
      WHERE id=${job.id} AND lease_token=${job.leaseToken} AND state IN ('preparing','publishing') RETURNING id`;
    if (rows.length)
      await tx`UPDATE post_deliveries SET state='failed',error='An earlier post in this sequence did not finish publishing. Later posts were not sent.',updated_at=now()
        WHERE group_id=${job.groupId} AND connection_id=${job.connectionId} AND post_index>${job.postIndex ?? 0} AND state='scheduled'`;
  });
}
