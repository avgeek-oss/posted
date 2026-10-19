import { after, afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import {
  sql,
  request,
  setupUser,
  resetDatabase,
  cleanupDatabase,
} from "./support.js";
import { app } from "../apps/api/src/app.js";
import { seal } from "../apps/api/src/social/secrets.js";
import {
  claimDelivery,
  completeDelivery,
  failDelivery,
  publishingBoundary,
} from "../apps/api/src/posts/queue.js";

process.env.POSTED_THREADS_CLIENT_ID = "threads-disposable-client";
process.env.POSTED_THREADS_CLIENT_SECRET = "threads-disposable-secret";
beforeEach(resetDatabase);
afterEach(() => mock.restoreAll());
after(cleanupDatabase);

function signed(
  overrides: Record<string, unknown> = {},
  secret = process.env.POSTED_THREADS_CLIENT_SECRET!,
) {
  const payload = Buffer.from(
    JSON.stringify({
      algorithm: "HMAC-SHA256",
      user_id: "1001",
      issued_at: Math.floor(Date.now() / 1000),
      ...overrides,
    }),
  ).toString("base64url");
  return `${createHmac("sha256", secret).update(payload).digest("base64url")}.${payload}`;
}
function callback(action: "deauthorize" | "data-deletion", value = signed()) {
  return app.request(`/api/social/threads/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ signed_request: value }),
  });
}
async function fixture() {
  const admin = await setupUser();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    await sql`INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,avatar_url,encrypted_credentials) VALUES(${id},(SELECT id FROM workspace),${i === 2 ? "x" : "threads"},${i === 1 ? "1002" : "1001"},${i === 0 ? "Delete this profile" : "Keep this profile"},${i === 0 ? "delete-me" : "keep-me"},'https://example.test/avatar',${seal({ accessToken: "disposable-token", issuedAt: Date.now(), expiresAt: Date.now() + 3600000 }, `social-connection:${id}`)})`;
  }
  const created = await request("/api/posts", {
    cookie: admin.cookie,
    body: {
      text: "Team master copy",
      connectionIds: ids,
      textOverrides: { [ids[0]!]: "Account copy" },
      mediaIds: [],
      additionalPosts: [
        {
          text: "Team second post",
          mediaIds: [],
          textOverrides: {
            [ids[0]!]: "Account reply",
            [ids[1]!]: "Other account reply",
          },
        },
      ],
      scheduledAt: new Date().toISOString(),
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(created.status, 201);
  return { ...admin, ids, post: (await created.json()).post };
}

test("Threads callbacks authenticate Meta form signatures without a browser session and reject forged or malformed requests", async () => {
  const { ids } = await fixture();
  const now = Math.floor(Date.now() / 1000);
  for (const value of [
    "",
    "invalid",
    signed({}, "wrong-secret"),
    signed({ algorithm: "none" }),
    signed({ user_id: "" }),
    signed({ user_id: 1001 }),
    signed({ issued_at: now + 301 }),
    signed({ issued_at: -1 }),
    signed({ issued_at: 1e15 }),
    signed() + ".extra",
    signed().replace(/.$/, "!"),
    `${"A".repeat(43)}.e30`,
  ]) {
    const response = await callback("data-deletion", value);
    assert.equal(response.status, 400);
    assert.ok(!(await response.text()).includes("disposable-secret"));
  }
  for (const body of ["", "signed_request=a&signed_request=b"])
    assert.equal(
      (
        await app.request("/api/social/threads/deauthorize", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await request("/api/social/threads/deauthorize", {
        body: { signed_request: signed() },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await app.request("/api/social/threads/deauthorize", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "signed_request=" + "a".repeat(16385),
      })
    ).status,
    413,
  );
  assert.equal(
    (await sql`SELECT request_hash FROM threads_account_events`).length,
    0,
  );
  const [connection] =
    await sql`SELECT state,encrypted_credentials FROM social_connections WHERE id=${ids[0]!}`;
  assert.equal(connection.state, "connected");
  assert.ok(connection.encryptedCredentials);
  assert.equal((await request("/api/connections")).status, 401);
});

test("Uninstall clears only matching Threads credentials and prevents a claimed job from publishing", async () => {
  const { ids, cookie } = await fixture();
  await sql`UPDATE post_deliveries SET available_at=now()+interval '1 day' WHERE connection_id<>${ids[0]!}`;
  const job = await claimDelivery();
  assert.ok(job);
  assert.equal(job.connectionId, ids[0]);
  const response = await callback("deauthorize");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(await publishingBoundary(job), false);
  const connections =
    await sql`SELECT id,state,encrypted_credentials FROM social_connections`;
  assert.equal(
    connections.find((c) => c.id === ids[0])?.encryptedCredentials,
    "",
  );
  assert.equal(connections.filter((c) => c.state === "connected").length, 2);
  assert.equal(
    (
      await sql`SELECT id FROM post_deliveries WHERE connection_id=${ids[0]!} AND state='cancelled'`
    ).length,
    2,
  );
  assert.equal(
    (await request(`/api/posts/${job.groupId}`, { cookie })).status,
    200,
  );
});

test("Deletion removes profile and delivery data, cleans account overrides, and keeps team drafts, media, users and other providers", async () => {
  const { ids, cookie, post } = await fixture();
  const draftId = randomUUID();
  const mediaId = randomUUID();
  await sql`INSERT INTO post_media(id,workspace_id,object_key,file_name,content_type,size_bytes,width,height,state) VALUES(${mediaId},(SELECT id FROM workspace),${`disposable/${mediaId}`},'team.png','image/png',100,10,10,'ready')`;
  const saved = await request(`/api/drafts/${draftId}`, {
    method: "POST",
    cookie,
    body: {
      text: "Keep draft",
      textOverrides: {
        [ids[0]!]: "Remove override",
        [ids[1]!]: "Keep override",
      },
      connectionIds: ids,
      additionalPosts: [
        {
          text: "Draft reply",
          mediaIds: [],
          textOverrides: { [ids[0]!]: "Remove nested override" },
        },
      ],
      mediaIds: [mediaId],
      mediaOverrides: { [ids[0]!]: [mediaId], [ids[1]!]: [] },
      version: 0,
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(saved.status, 201);
  await sql`INSERT INTO post_group_media_overrides(group_id,workspace_id,post_index,connection_id) VALUES(${post.id},(SELECT id FROM workspace),0,${ids[0]!})`;
  await sql`INSERT INTO post_resume_requests(workspace_id,idempotency_key,group_id,connection_id,request_hash) VALUES((SELECT id FROM workspace),${randomUUID()},${post.id},${ids[0]!},'disposable-hash')`;
  await sql`UPDATE post_deliveries SET state='published',provider_post_id='private-provider-id',published_url='https://threads.net/@delete-me/post/fixture',published_at=now(),provider_checkpoint=${sql.json({ id: "provider-container" })} WHERE connection_id=${ids[0]!}`;
  const response = await callback("data-deletion");
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.match(receipt.confirmation_code, /^[a-f0-9]{48}$/);
  assert.equal(
    receipt.url,
    `${process.env.POSTED_API_URL}/api/social/threads/data-deletion/${receipt.confirmation_code}`,
  );
  for (const table of [
    "social_connections",
    "post_deliveries",
    "post_group_media_overrides",
    "post_draft_media_overrides",
    "post_resume_requests",
  ]) {
    const rows = await sql.unsafe(
      `SELECT * FROM ${table} WHERE ${table === "social_connections" ? "id" : "connection_id"}=$1`,
      [ids[0]!],
    );
    assert.equal(rows.length, 0, table);
  }
  assert.equal((await sql`SELECT id FROM social_connections`).length, 2);
  assert.equal((await sql`SELECT id FROM users`).length, 1);
  assert.equal(
    (await sql`SELECT id FROM post_media WHERE id=${mediaId}`).length,
    1,
  );
  const draft = (
    await (await request(`/api/drafts/${draftId}`, { cookie })).json()
  ).draft;
  assert.equal(draft.text, "Keep draft");
  assert.equal(draft.version, 2);
  assert.deepEqual(draft.connectionIds.sort(), ids.slice(1).sort());
  assert.deepEqual(draft.textOverrides, { [ids[1]!]: "Keep override" });
  assert.deepEqual(draft.additionalPosts[0].textOverrides, {});
  assert.equal(draft.media.length, 1);
  assert.deepEqual(draft.mediaOverrides, { [ids[1]!]: [] });
  const group = (
    await (await request(`/api/posts/${post.id}`, { cookie })).json()
  ).post;
  assert.equal(group.deliveries.length, 4);
  assert.deepEqual(group.additionalPosts[0].textOverrides, {
    [ids[1]!]: "Other account reply",
  });
  const status = await app.request(new URL(receipt.url).pathname);
  assert.equal(status.status, 200);
  assert.equal(status.headers.get("cache-control"), "no-store");
  assert.equal(status.headers.get("referrer-policy"), "no-referrer");
  assert.match(status.headers.get("content-type")!, /text\/html/);
  const text = await status.text();
  assert.match(text, /Threads data deletion complete/);
  for (const privateValue of [
    "delete-me",
    "1001",
    "disposable-token",
    "private-provider-id",
  ])
    assert.ok(!text.includes(privateValue));
  const [event] = await sql`SELECT * FROM threads_account_events`;
  const stored = JSON.stringify(event);
  assert.ok(
    !stored.includes("delete-me") &&
      !stored.includes("user_id") &&
      !stored.includes("disposable-token"),
  );
  assert.equal(
    (await app.request("/api/social/threads/data-deletion/" + "0".repeat(48)))
      .status,
    404,
  );
  assert.equal(
    (await app.request("/api/social/threads/data-deletion/1001")).status,
    404,
  );
});

test("Concurrent duplicate deletion requests return one receipt and leave no history error when the account was the only target", async () => {
  const { ids, cookie, post } = await fixture();
  await sql`DELETE FROM post_deliveries WHERE connection_id<>${ids[0]!}`;
  const value = signed();
  const responses = await Promise.all([
    callback("data-deletion", value),
    callback("data-deletion", value),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  assert.deepEqual(await responses[0]!.json(), await responses[1]!.json());
  assert.equal((await sql`SELECT * FROM threads_account_events`).length, 1);
  assert.equal(
    (await request(`/api/posts/${post.id}`, { cookie })).status,
    404,
  );
  const history = await request("/api/posts?view=history", { cookie });
  assert.equal(history.status, 200);
  assert.equal((await history.json()).total, 0);
  await sql`UPDATE social_connections SET state='connected' WHERE id=${ids[1]!}`;
});

test("Deletion invalidates an in-flight publishing lease so completion and retries cannot recreate erased records", async () => {
  const { ids } = await fixture();
  await sql`UPDATE post_deliveries SET available_at=now()+interval '1 day' WHERE connection_id<>${ids[0]!}`;
  const job = await claimDelivery();
  assert.ok(job);
  assert.equal(await publishingBoundary(job), true);
  assert.equal((await callback("data-deletion")).status, 200);
  await assert.rejects(
    completeDelivery(job, {
      id: "late-result",
      url: "https://threads.net/post/late",
    }),
    /lease expired/,
  );
  await failDelivery(job, "Temporary failure", false, { retryAfterMs: 0 });
  assert.equal(await claimDelivery(), null);
  assert.equal(
    (await sql`SELECT id FROM post_deliveries WHERE connection_id=${ids[0]!}`)
      .length,
    0,
  );
});

test("A valid deletion for an unknown account returns a private completion receipt without touching team data", async () => {
  const { ids } = await fixture();
  const response = await callback("data-deletion", signed({ user_id: "9999" }));
  assert.equal(response.status, 200);
  assert.equal(
    (await sql`SELECT id FROM social_connections`).length,
    ids.length,
  );
  assert.equal(
    (await app.request(new URL((await response.json()).url).pathname)).status,
    200,
  );
});

test("Callbacks fail closed when Threads is not configured", async () => {
  const secret = process.env.POSTED_THREADS_CLIENT_SECRET;
  const client = process.env.POSTED_THREADS_CLIENT_ID;
  try {
    process.env.POSTED_THREADS_CLIENT_ID = "";
    process.env.POSTED_THREADS_CLIENT_SECRET = "";
    assert.equal(
      (await callback("deauthorize", signed({}, "old-secret"))).status,
      404,
    );
    assert.equal((await sql`SELECT * FROM threads_account_events`).length, 0);
  } finally {
    process.env.POSTED_THREADS_CLIENT_SECRET = secret;
    process.env.POSTED_THREADS_CLIENT_ID = client;
  }
});

test("Revocation blocks an OAuth flow started before the event but permits an explicit fresh connection and ignores event replay", async () => {
  const { ids, cookie } = await fixture();
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      url.pathname === "/oauth/access_token" ||
      url.pathname === "/access_token"
    )
      return Response.json({
        access_token: "new-disposable-access",
        expires_in: 3600,
      });
    if (url.pathname === "/v1.0/me")
      return Response.json({
        id: "1001",
        username: "reconnected",
        name: "Fresh connection",
      });
    throw new Error("Unexpected provider call");
  });
  async function start() {
    const response = await request("/api/social/connect/threads", {
      cookie,
      body: {},
    });
    assert.equal(response.status, 200);
    return new URL((await response.json()).authorizationUrl).searchParams.get(
      "state",
    );
  }
  const pending = await start();
  const value = signed();
  assert.equal((await callback("deauthorize", value)).status, 200);
  assert.equal(
    (
      await request(
        `/api/social/callback/threads?state=${pending}&code=fixture`,
        { cookie },
      )
    ).status,
    409,
  );
  const fresh = await start();
  assert.equal(
    (
      await request(
        `/api/social/callback/threads?state=${fresh}&code=fixture`,
        { cookie },
      )
    ).status,
    302,
  );
  assert.equal((await callback("deauthorize", value)).status, 200);
  const [connection] =
    await sql`SELECT state,name FROM social_connections WHERE id=${ids[0]!}`;
  assert.equal(connection.state, "connected");
  assert.equal(connection.name, "Fresh connection");
  assert.equal((await sql`SELECT * FROM threads_account_events`).length, 1);
});

test("Delayed signed deletion requests still remove stored data even after a token refresh", async () => {
  const { ids } = await fixture();
  await sql`UPDATE social_connections SET updated_at=now() WHERE id=${ids[0]!}`;
  assert.equal(
    (
      await callback(
        "data-deletion",
        signed({ issued_at: Math.floor(Date.now() / 1000) - 30 }),
      )
    ).status,
    200,
  );
  assert.equal(
    (await sql`SELECT id FROM social_connections WHERE id=${ids[0]!}`).length,
    0,
  );
});

test("Deletion rolls back the receipt and every account change if cleanup cannot commit", async () => {
  const { ids } = await fixture();
  await sql.unsafe(
    `CREATE FUNCTION refuse_threads_deletion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Disposable cleanup failure'; END $$`,
  );
  await sql.unsafe(
    `CREATE TRIGGER refuse_threads_deletion BEFORE DELETE ON social_connections FOR EACH ROW EXECUTE FUNCTION refuse_threads_deletion()`,
  );
  try {
    assert.equal((await callback("data-deletion")).status, 500);
    assert.equal(
      (await sql`SELECT request_hash FROM threads_account_events`).length,
      0,
    );
    assert.equal(
      (await sql`SELECT id FROM post_deliveries WHERE connection_id=${ids[0]!}`)
        .length,
      2,
    );
    assert.equal(
      (await sql`SELECT state FROM social_connections WHERE id=${ids[0]!}`)[0]
        ?.state,
      "connected",
    );
  } finally {
    await sql.unsafe(
      `DROP TRIGGER refuse_threads_deletion ON social_connections`,
    );
    await sql.unsafe(`DROP FUNCTION refuse_threads_deletion()`);
  }
  assert.equal((await callback("data-deletion")).status, 200);
});
