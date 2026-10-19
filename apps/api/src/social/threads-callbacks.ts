import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { html } from "hono/html";
import { z } from "zod";
import {
  sql,
  withDatabaseTransaction,
} from "../../../../packages/database/src/index.js";
import { lockAuthority } from "../authority.js";
import { config } from "../config.js";
import { errorResponse, type Env } from "../http.js";
import { rateLimit } from "../middleware.js";

const invalidRequest = () =>
  new HTTPException(400, { message: "The Threads signed request is invalid" });
const payloadSchema = z.object({
  algorithm: z.literal("HMAC-SHA256"),
  user_id: z.string().regex(/^[0-9]{1,64}$/),
  issued_at: z.number().int().positive().max(8640000000000),
});

function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw invalidRequest();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value.replace(/=+$/, ""))
    throw invalidRequest();
  return bytes;
}

function verifyRequest(value: string, secret: string) {
  const [signature, payload, extra] = value.split(".");
  if (!signature || !payload || extra !== undefined) throw invalidRequest();
  const supplied = decode(signature);
  const expected = createHmac("sha256", secret).update(payload).digest();
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw invalidRequest();
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(decode(payload)),
    );
  } catch {
    throw invalidRequest();
  }
  const result = payloadSchema.safeParse(parsed);
  if (!result.success || result.data.issued_at > Date.now() / 1000 + 300)
    throw invalidRequest();
  return result.data;
}

export function threadsSubjectHash(accountId: string) {
  const value = config();
  return createHmac("sha256", value.POSTED_SECRET)
    .update(`threads:${value.POSTED_THREADS_CLIENT_ID}:${accountId}`)
    .digest("hex");
}

export async function checkThreadsAuthorization(
  accountId: string,
  stateHash: string,
) {
  const [event] =
    await sql`SELECT 1 FROM threads_account_events e JOIN social_oauth_requests r ON r.state_hash=${stateHash} WHERE e.subject_hash=${threadsSubjectHash(accountId)} AND e.received_at>=r.created_at LIMIT 1`;
  if (event)
    throw new HTTPException(409, {
      message:
        "Threads access changed during authorization. Start a new connection.",
    });
}

async function deleteAccount(connectionId: string) {
  // Master copy and uploaded originals belong to the team, rather than the provider profile.
  await sql`UPDATE post_drafts SET connection_ids=array_remove(connection_ids,${connectionId}::uuid),text_overrides=text_overrides-${connectionId},
    additional_posts=COALESCE((SELECT jsonb_agg(CASE WHEN post ? 'textOverrides' THEN jsonb_set(post,'{textOverrides}',(post->'textOverrides')-${connectionId}) ELSE post END ORDER BY position) FROM jsonb_array_elements(additional_posts) WITH ORDINALITY AS items(post,position)),'[]'::jsonb),
    version=version+1,updated_at=now() WHERE ${connectionId}::uuid=ANY(connection_ids) OR text_overrides ? ${connectionId}
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(additional_posts) post WHERE post->'textOverrides' ? ${connectionId})`;
  await sql`UPDATE post_groups SET additional_posts=COALESCE((SELECT jsonb_agg(CASE WHEN post ? 'textOverrides' THEN jsonb_set(post,'{textOverrides}',(post->'textOverrides')-${connectionId}) ELSE post END ORDER BY position) FROM jsonb_array_elements(additional_posts) WITH ORDINALITY AS items(post,position)),'[]'::jsonb),
    version=version+1,updated_at=now() WHERE EXISTS(SELECT 1 FROM post_deliveries WHERE group_id=post_groups.id AND connection_id=${connectionId})`;
  await sql`DELETE FROM post_draft_media_overrides WHERE connection_id=${connectionId}`;
  await sql`DELETE FROM post_group_media_overrides WHERE connection_id=${connectionId}`;
  await sql`DELETE FROM post_resume_requests WHERE connection_id=${connectionId}`;
  await sql`DELETE FROM post_deliveries WHERE connection_id=${connectionId}`;
  await sql`DELETE FROM social_connections WHERE id=${connectionId}`;
}

export const threadsCallbackRoutes = new Hono<Env>();
threadsCallbackRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Robots-Tag", "noindex, nofollow");
  await next();
});
threadsCallbackRoutes.use(
  "*",
  bodyLimit({
    maxSize: 16384,
    onError: (c) => errorResponse(c, 413, "Request is too large"),
  }),
  rateLimit,
);

for (const action of ["deauthorize", "delete"] as const) {
  threadsCallbackRoutes.post(
    action === "delete" ? "/data-deletion" : "/deauthorize",
    async (c) => {
      const value = config();
      if (
        !value.POSTED_THREADS_CLIENT_ID ||
        !value.POSTED_THREADS_CLIENT_SECRET
      )
        throw new HTTPException(404);
      if (
        c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/x-www-form-urlencoded"
      )
        throw invalidRequest();
      const form = new URLSearchParams(await c.req.text());
      const requests = form.getAll("signed_request");
      if (requests.length !== 1) throw invalidRequest();
      const signedRequest = requests[0]!;
      const payload = verifyRequest(
        signedRequest,
        value.POSTED_THREADS_CLIENT_SECRET,
      );
      const subjectHash = threadsSubjectHash(payload.user_id);
      const requestHash = createHash("sha256")
        .update(`${action}:${subjectHash}:${payload.issued_at}`)
        .digest("hex");
      const code = await withDatabaseTransaction(async () => {
        await sql.begin(lockAuthority);
        const [previous] = await sql<
          { confirmationCode: string | null }[]
        >`SELECT confirmation_code FROM threads_account_events WHERE request_hash=${requestHash}`;
        if (previous) return previous.confirmationCode;
        const confirmationCode =
          action === "delete" ? randomBytes(24).toString("hex") : null;
        const issuedAt = new Date(payload.issued_at * 1000);
        await sql`INSERT INTO threads_account_events(request_hash,subject_hash,action,issued_at,confirmation_code) VALUES(${requestHash},${subjectHash},${action},${issuedAt},${confirmationCode})`;
        const connections = await sql<
          { id: string }[]
        >`SELECT id FROM social_connections WHERE provider='threads' AND account_id=${payload.user_id} FOR UPDATE`;
        for (const connection of connections) {
          if (action === "delete") await deleteAccount(connection.id);
          else {
            await sql`UPDATE social_connections SET state='disconnected',encrypted_credentials='',updated_at=now() WHERE id=${connection.id}`;
            await sql`UPDATE post_deliveries SET retry_cancelled_at=now(),updated_at=now() WHERE connection_id=${connection.id} AND state IN ('scheduled','preparing','publishing')`;
            await sql`UPDATE post_deliveries SET state='cancelled',error='Threads access was removed',lease_token=NULL,lease_until=NULL,provider_checkpoint=NULL,updated_at=now() WHERE connection_id=${connection.id} AND state IN ('scheduled','preparing')`;
          }
        }
        return confirmationCode;
      });
      if (action === "deauthorize") return c.json({ success: true });
      return c.json({
        url: new URL(
          `/api/social/threads/data-deletion/${code}`,
          value.POSTED_API_URL,
        ).href,
        confirmation_code: code,
      });
    },
  );
}

threadsCallbackRoutes.get("/data-deletion/:code", async (c) => {
  const code = c.req.param("code");
  if (!/^[a-f0-9]{48}$/.test(code)) throw new HTTPException(404);
  const [receipt] =
    await sql`SELECT 1 FROM threads_account_events WHERE confirmation_code=${code} AND action='delete'`;
  if (!receipt) throw new HTTPException(404);
  return c.html(
    html`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Threads data deletion | Posted</title>
        </head>
        <body>
          <main>
            <h1>Threads data deletion complete</h1>
            <p>
              Posted has removed the matching Threads connection, stored
              credentials, profile information and delivery records.
            </p>
            <p>
              Team-authored posts and uploaded files remain in the team
              workspace. Posts already sent to Threads remain on Threads. A
              publishing request already in progress cannot be recalled.
            </p>
            <p>Confirmation code: <code>${code}</code></p>
          </main>
        </body>
      </html>`,
  );
});
