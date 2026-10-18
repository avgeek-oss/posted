import { after, afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  sql,
  request,
  setupUser,
  resetDatabase,
  cleanupDatabase,
} from "./support.js";
import { seal } from "../apps/api/src/social/secrets.js";
import {
  claimDelivery,
  completeDelivery,
  failDelivery,
  publishingBoundary,
} from "../apps/api/src/posts/queue.js";
import { deliverNext } from "../apps/worker/src/delivery.js";
import {
  ProviderFailure,
  providerRequest,
} from "../apps/api/src/social/network.js";
import type { Post } from "../packages/contracts/src/index.js";

beforeEach(resetDatabase);
afterEach(() => mock.restoreAll());
after(cleanupDatabase);
process.env.POSTED_X_CLIENT_ID = "retry-local-client";
process.env.POSTED_X_CLIENT_SECRET = "retry-local-secret";

async function sequence(expiredToken = false) {
  const admin = await setupUser();
  const connectionId = randomUUID();
  const token = seal(
    {
      accessToken: "retry-disposable-access",
      refreshToken: "retry-disposable-refresh",
      issuedAt: Date.now(),
      expiresAt: Date.now() + (expiredToken ? -1 : 3600000),
    },
    `social-connection:${connectionId}`,
  );
  await sql`INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,encrypted_credentials) VALUES(${connectionId},(SELECT id FROM workspace),'x',${randomUUID()},'Retry account','example',${token})`;
  const created = await request("/api/posts", {
    cookie: admin.cookie,
    body: {
      text: "First post",
      additionalPosts: [
        { text: "Second post", mediaIds: [] },
        { text: "Third post", mediaIds: [] },
      ],
      connectionIds: [connectionId],
      mediaIds: [],
      scheduledAt: new Date().toISOString(),
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(created.status, 201);
  const post: Post = (await created.json()).post;
  return { ...admin, post, connectionId };
}

async function interrupted() {
  const value = await sequence();
  const first = await claimDelivery();
  assert.ok(first);
  assert.equal(await publishingBoundary(first), true);
  await completeDelivery(first, {
    id: "confirmed-root",
    url: "https://x.com/i/status/confirmed-root",
  });
  const second = await claimDelivery();
  assert.ok(second);
  await failDelivery(second, "Definitive rejection", false);
  return value;
}

test("rate-limited replies wait for Retry-After and continue the original thread once", async () => {
  const value = await sequence();
  const payloads: { text: string; reply?: { in_reply_to_tweet_id: string } }[] =
    [];
  mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), "https://api.x.com/2/tweets");
      payloads.push(JSON.parse(String(init?.body)));
      if (payloads.length === 2)
        return new Response(null, {
          status: 429,
          headers: { "Retry-After": "120" },
        });
      return Response.json({ data: { id: `tweet-${payloads.length}` } });
    },
  );
  assert.equal(await deliverNext(), true);
  const before = Date.now();
  assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), false);
  const [retry] =
    await sql`SELECT state,available_at,attempts,retry_attempts FROM post_deliveries WHERE post_index=1`;
  assert.equal(retry.state, "scheduled");
  assert.equal(retry.attempts, 1);
  assert.ok(new Date(retry.availableAt).getTime() >= before + 120000);
  const visible: Post = (
    await (
      await request(`/api/posts/${value.post.id}`, { cookie: value.cookie })
    ).json()
  ).post;
  assert.ok(visible.deliveries[1].nextAttemptAt);
  assert.deepEqual(visible.resumableConnectionIds, []);
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second' WHERE post_index=1`;
  assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), false);
  assert.deepEqual(
    payloads.map((p) => p.reply?.in_reply_to_tweet_id),
    [undefined, "tweet-1", "tweet-1", "tweet-3"],
  );
  assert.equal(payloads.filter((p) => p.text === "First post").length, 1);
  assert.equal(
    (
      await sql`SELECT count(*)::int AS count FROM post_deliveries WHERE state='published'`
    )[0].count,
    3,
  );
});

test("waiting for an automatic retry does not reopen content editing", async () => {
  const value = await sequence();
  mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 429 }),
  );
  assert.equal(await deliverNext(), true);
  const result = await request(`/api/posts/${value.post.id}`, {
    cookie: value.cookie,
    method: "PATCH",
    body: {
      text: "Changed while waiting",
      mediaIds: [],
      connectionIds: [value.connectionId],
      additionalPosts: [{ text: "Changed reply", mediaIds: [] }],
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      version: 1,
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(result.status, 409);
  assert.equal((await sql`SELECT text FROM post_groups`)[0].text, "First post");
});

test("resuming one account leaves another account's uncertain outcomes untouched", async () => {
  const value = await interrupted();
  const [other] =
    await sql`INSERT INTO social_connections(workspace_id,provider,account_id,name,handle,encrypted_credentials) VALUES((SELECT id FROM workspace),'linkedin',${randomUUID()},'Other account','other','fixture') RETURNING id`;
  await sql`INSERT INTO post_deliveries(group_id,workspace_id,connection_id,post_index,state,available_at,error) SELECT ${value.post.id},id,${other.id},0,'uncertain',now(),'Unconfirmed result' FROM workspace`;
  const result = await request(`/api/posts/${value.post.id}/resume`, {
    cookie: value.cookie,
    body: {
      connectionId: value.connectionId,
      version: 1,
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(result.status, 200);
  assert.equal(
    (
      await sql`SELECT state FROM post_deliveries WHERE connection_id=${other.id}`
    )[0].state,
    "uncertain",
  );
  assert.equal(
    (
      await sql`SELECT provider_post_id FROM post_deliveries WHERE connection_id=${value.connectionId} AND post_index=0`
    )[0].providerPostId,
    "confirmed-root",
  );
});

test("temporary token preparation failures retry before any tweet is sent", async () => {
  await sequence(true);
  let refreshes = 0;
  let publishes = 0;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).endsWith("/oauth2/token")) {
      refreshes++;
      return refreshes === 1
        ? new Response(null, { status: 503 })
        : Response.json({
            access_token: "renewed-disposable-token",
            expires_in: 3600,
          });
    }
    publishes++;
    return Response.json({ data: { id: "confirmed-root" } });
  });
  assert.equal(await deliverNext(), true);
  assert.equal(publishes, 0);
  assert.equal(await deliverNext(), false);
  const [retry] =
    await sql`SELECT state,available_at FROM post_deliveries WHERE post_index=0`;
  assert.equal(retry.state, "scheduled");
  assert.ok(new Date(retry.availableAt).getTime() > Date.now());
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
  assert.equal(await deliverNext(), true);
  assert.equal(publishes, 1);
  assert.equal(refreshes, 2);
});

test("backoff grows, attempts are bounded, and later posts stop after exhaustion", async () => {
  await sequence();
  mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 429 }),
  );
  for (let attempt = 1; attempt <= 5; attempt++) {
    const before = Date.now();
    assert.equal(await deliverNext(), true);
    const [row] =
      await sql`SELECT state,available_at,retry_attempts,attempts FROM post_deliveries WHERE post_index=0`;
    assert.equal(row.attempts, attempt);
    assert.equal(row.retryAttempts, attempt);
    if (attempt < 5) {
      assert.equal(row.state, "scheduled");
      const delay = new Date(row.availableAt).getTime() - before;
      const expected = 30000 * 2 ** (attempt - 1);
      assert.ok(delay >= expected && delay < expected * 1.25 + 2000);
      assert.equal(await deliverNext(), false);
      await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second' WHERE post_index=0`;
    } else assert.equal(row.state, "failed");
  }
  assert.equal(await deliverNext(), false);
  assert.deepEqual(
    (await sql`SELECT state FROM post_deliveries ORDER BY post_index`).map(
      (row) => row.state,
    ),
    ["failed", "failed", "failed"],
  );
});

test("unconfirmed publication and permanent rejection are never automatically retried", async () => {
  for (const status of [0, 408, 503, 400, 401, 403]) {
    await resetDatabase();
    const value = await sequence();
    let sent = 0;
    mock.method(globalThis, "fetch", async () => {
      sent++;
      if (status === 0) throw new TypeError("Response was lost");
      return new Response(null, { status });
    });
    assert.equal(await deliverNext(), true);
    assert.equal(await deliverNext(), false);
    assert.equal(sent, 1);
    const uncertain = [0, 408, 503].includes(status);
    assert.equal(
      (await sql`SELECT state FROM post_deliveries WHERE post_index=0`)[0]
        .state,
      uncertain ? "uncertain" : "failed",
    );
    if (uncertain) {
      const result = await request(`/api/posts/${value.post.id}/resume`, {
        cookie: value.cookie,
        body: {
          connectionId: value.connectionId,
          version: 1,
          idempotencyKey: randomUUID(),
        },
      });
      assert.equal(result.status, 409);
    }
    mock.restoreAll();
  }
});

test("resume is content-bound and idempotent, preserves published posts, and restores reply links", async () => {
  const value = await interrupted();
  const path = `/api/posts/${value.post.id}/resume`;
  const body = {
    connectionId: value.connectionId,
    version: 1,
    idempotencyKey: randomUUID(),
  };
  const read: Post = (
    await (
      await request(`/api/posts/${value.post.id}`, { cookie: value.cookie })
    ).json()
  ).post;
  assert.deepEqual(read.resumableConnectionIds, [value.connectionId]);
  const results = await Promise.all([
    request(path, { cookie: value.cookie, body }),
    request(path, { cookie: value.cookie, body }),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  assert.ok(
    results.some((r) => r.headers.get("Idempotency-Replayed") === "true"),
  );
  assert.equal((await sql`SELECT version FROM post_groups`)[0].version, 2);
  assert.equal(
    (await sql`SELECT count(*)::int AS count FROM post_resume_requests`)[0]
      .count,
    1,
  );
  const deliveries =
    await sql`SELECT state,provider_post_id,attempts,retry_attempts FROM post_deliveries ORDER BY post_index`;
  assert.equal(deliveries[0].providerPostId, "confirmed-root");
  assert.equal(deliveries[0].state, "published");
  assert.equal(deliveries[1].attempts, 1);
  assert.equal(deliveries[1].retryAttempts, 0);
  assert.equal(
    (
      await request(path, {
        cookie: value.cookie,
        body: { ...body, version: 2 },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(path, {
        cookie: value.cookie,
        body: { ...body, idempotencyKey: randomUUID() },
      })
    ).status,
    409,
  );
  const replies: string[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      replies.push(payload.reply.in_reply_to_tweet_id);
      return Response.json({ data: { id: `resumed-${replies.length}` } });
    },
  );
  assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), true);
  assert.deepEqual(replies, ["confirmed-root", "resumed-1"]);
  assert.equal(
    (await request(path, { cookie: value.cookie, body })).status,
    200,
  );
  assert.equal(await deliverNext(), false);
  assert.equal(replies.length, 2);
});

test("concurrent new resume requests cannot start two runs or race a claimed delivery", async () => {
  const value = await interrupted();
  const path = `/api/posts/${value.post.id}/resume`;
  const results = await Promise.all(
    Array.from({ length: 2 }, () =>
      request(path, {
        cookie: value.cookie,
        body: {
          connectionId: value.connectionId,
          version: 1,
          idempotencyKey: randomUUID(),
        },
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const claims = await Promise.all([claimDelivery(), claimDelivery()]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(
    (
      await request(path, {
        cookie: value.cookie,
        body: {
          connectionId: value.connectionId,
          version: 2,
          idempotencyKey: randomUUID(),
        },
      })
    ).status,
    409,
  );
});

test("resume rejects disconnected, cancelled, non-contiguous, or already-confirmed failed records", async () => {
  const value = await interrupted();
  const path = `/api/posts/${value.post.id}/resume`;
  const resume = () =>
    request(path, {
      cookie: value.cookie,
      body: {
        connectionId: value.connectionId,
        version: 1,
        idempotencyKey: randomUUID(),
      },
    });
  await sql`UPDATE social_connections SET state='disconnected'`;
  assert.equal((await resume()).status, 409);
  await sql`UPDATE social_connections SET state='connected'`;
  await sql`UPDATE post_deliveries SET provider_post_id='already-sent' WHERE post_index=1`;
  assert.equal((await resume()).status, 409);
  await sql`UPDATE post_deliveries SET provider_post_id=NULL WHERE post_index=1`;
  await sql`UPDATE post_deliveries SET state='published',provider_post_id='out-of-order' WHERE post_index=2`;
  assert.equal((await resume()).status, 409);
  await sql`UPDATE post_deliveries SET state='failed',provider_post_id=NULL WHERE post_index=2`;
  await sql`UPDATE post_groups SET cancelled_at=now()`;
  assert.equal((await resume()).status, 409);
});

test("read-only browser and REST credentials cannot resume; an edit key can", async () => {
  const value = await interrupted();
  const path = `/api/posts/${value.post.id}/resume`;
  const body = {
    connectionId: value.connectionId,
    version: 1,
    idempotencyKey: randomUUID(),
  };
  const viewerId = randomUUID();
  await sql`INSERT INTO users(id,workspace_id,name,email,password_hash,email_verified,role) SELECT ${viewerId},workspace_id,'Viewer','viewer@example.test',password_hash,true,'viewer' FROM users WHERE id=${value.user.id}`;
  const login = await request("/api/auth/login", {
    body: {
      email: "viewer@example.test",
      password: "Secure test passphrase 42!",
    },
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  assert.equal((await request(path, { cookie, body })).status, 403);
  const read = await request("/api/team-credentials", {
    cookie: value.cookie,
    body: {
      name: "Read test",
      access: "read",
      includeAdmin: false,
      expiresAt: null,
    },
  });
  assert.equal(read.status, 201);
  assert.equal(
    (await request(path, { token: (await read.json()).token, body })).status,
    403,
  );
  const edit = await request("/api/team-credentials", {
    cookie: value.cookie,
    body: {
      name: "Edit test",
      access: "edit",
      includeAdmin: false,
      expiresAt: null,
    },
  });
  assert.equal(edit.status, 201);
  assert.equal(
    (await request(path, { token: (await edit.json()).token, body })).status,
    200,
  );
});

test("Retry-After dates and X rate-limit reset headers are preserved without response bodies", async () => {
  const reset = Math.ceil(Date.now() / 1000) + 300;
  const examples: Record<string, string>[] = [
    { "Retry-After": new Date(Date.now() + 180000).toUTCString() },
    { "x-rate-limit-reset": String(reset) },
    { "Retry-After": "invalid" },
  ];
  for (const headers of examples) {
    mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response("sensitive provider response", { status: 429, headers }),
    );
    await assert.rejects(
      providerRequest("https://provider.example.test"),
      (error: unknown) => {
        assert.ok(error instanceof ProviderFailure);
        assert.equal(error.uncertain, false);
        assert.ok(!error.message.includes("sensitive"));
        assert.ok(
          error.retryAfterMs >=
            ("x-rate-limit-reset" in headers
              ? 298000
              : headers["Retry-After"] === "invalid"
                ? 0
                : 178000),
        );
        return true;
      },
    );
    mock.restoreAll();
  }
});

test("crashed preparation is delayed, stale leases cannot complete, and crash recovery is bounded", async () => {
  await sequence();
  const original = await claimDelivery();
  assert.ok(original);
  await sql`UPDATE post_deliveries SET lease_until=now()-interval '1 second' WHERE post_index=0`;
  assert.equal(await claimDelivery(), null);
  assert.equal(await publishingBoundary(original), false);
  await failDelivery(original, "Stale failure", false, { retryAfterMs: 0 });
  assert.equal(
    (await sql`SELECT state FROM post_deliveries WHERE post_index=0`)[0].state,
    "scheduled",
  );
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second' WHERE post_index=0`;
  const last = await claimDelivery();
  assert.ok(last);
  await sql`UPDATE post_deliveries SET retry_attempts=5,lease_until=now()-interval '1 second' WHERE post_index=0`;
  assert.equal(await claimDelivery(), null);
  assert.deepEqual(
    (await sql`SELECT state FROM post_deliveries ORDER BY post_index`).map(
      (row) => row.state,
    ),
    ["failed", "failed", "failed"],
  );
});
