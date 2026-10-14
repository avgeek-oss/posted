import { randomUUID } from "node:crypto";
import { sql } from "../../../../packages/database/src/index.js";
import type { Provider } from "../../../../packages/contracts/src/index.js";

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
};

export async function claimDelivery(): Promise<DeliveryJob | null> {
  return sql.begin(async (tx) => {
    // A crash before publishing is safe to retry. A crash after the publishing boundary isn't.
    await tx`UPDATE post_deliveries SET state='scheduled',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE state='preparing' AND lease_until<now()`;
    await tx`UPDATE post_deliveries SET state='uncertain',error='The publishing response was not received. Check the connected account before trying again.',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE state='publishing' AND lease_until<now()`;
    const [next] = await tx<{ id: string; groupId: string }[]>`
      SELECT d.id,d.group_id FROM post_deliveries d JOIN post_groups g ON g.id=d.group_id
      WHERE d.state='scheduled' AND d.available_at<=now() AND g.cancelled_at IS NULL
      ORDER BY d.available_at,d.created_at FOR UPDATE OF d,g SKIP LOCKED LIMIT 1`;
    if (!next) return null;
    const token = randomUUID();
    const [job] = await tx<DeliveryJob[]>`
      UPDATE post_deliveries d SET state='preparing',lease_token=${token},lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now()
      FROM post_groups g,social_connections c WHERE d.id=${next.id} AND g.id=d.group_id AND c.id=d.connection_id
      RETURNING d.id,d.group_id,d.workspace_id,d.connection_id,d.lease_token,c.provider,COALESCE(d.text_override,g.text) AS text,c.account_id,c.encrypted_credentials`;
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
  result: { id: string; url: string },
) {
  const rows =
    await sql`UPDATE post_deliveries SET state='published',provider_post_id=${result.id},published_url=${result.url},published_at=now(),lease_token=NULL,lease_until=NULL,error=NULL,updated_at=now()
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
) {
  await sql`UPDATE post_deliveries SET state=${uncertain ? "uncertain" : "failed"},error=${error},lease_token=NULL,lease_until=NULL,updated_at=now()
    WHERE id=${job.id} AND lease_token=${job.leaseToken} AND state IN ('preparing','publishing')`;
}
