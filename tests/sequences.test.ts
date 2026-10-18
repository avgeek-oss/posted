import { after, afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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
import { preparePublication } from "../apps/api/src/social/publish.js";
import type {
  Post,
  PostDraft,
  PostInput,
  Provider,
  SocialConnectionSummary,
} from "../packages/contracts/src/index.js";

beforeEach(resetDatabase);
afterEach(() => mock.restoreAll());
after(cleanupDatabase);
process.env.POSTED_X_CLIENT_ID = "sequence-local-client";
process.env.POSTED_X_CLIENT_SECRET = "sequence-local-secret";
process.env.POSTED_LINKEDIN_CLIENT_ID = "sequence-local-client";
process.env.POSTED_LINKEDIN_CLIENT_SECRET = "sequence-local-secret";
process.env.POSTED_THREADS_CLIENT_ID = "sequence-local-client";
process.env.POSTED_THREADS_CLIENT_SECRET = "sequence-local-secret";

async function account(
  provider: Provider = "x",
  connectedBy: string | null = null,
) {
  const id = randomUUID();
  const credential = seal(
    {
      accessToken: "sequence-disposable-token",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    },
    `social-connection:${id}`,
  );
  await sql`INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,encrypted_credentials,connected_by) VALUES(${id},(SELECT id FROM workspace),${provider},${`account-${id}`},'Sequence account','example',${credential},${connectedBy})`;
  return id;
}
function input(ids: string[], additional = 2): PostInput {
  return {
    text: "First post",
    mediaIds: [],
    connectionIds: ids,
    additionalPosts: Array.from({ length: additional }, (_, index) => ({
      text: `Post ${index + 2}`,
      mediaIds: [],
      textOverrides: {},
    })),
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    idempotencyKey: randomUUID(),
  };
}
async function create(cookie: string, body: PostInput) {
  const result = await request("/api/posts", { cookie, body });
  assert.equal(result.status, 201, JSON.stringify(await result.clone().json()));
  return (await result.json()).post as Post;
}

test("one logical request persists every ordered post and account, with concurrent replay and content conflicts", async () => {
  const admin = await setupUser();
  const ids = [await account(), await account("linkedin")];
  const body = input(ids, 30);
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      request("/api/posts", { cookie: admin.cookie, body }),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    [200, 200, 201],
  );
  const post: Post = (await results[0].json()).post;
  assert.equal(post.additionalPosts.length, 30);
  assert.equal(post.deliveries.length, 62);
  assert.equal((await sql`SELECT id FROM post_groups`).length, 1);
  assert.deepEqual(
    [...new Set(post.deliveries.map((delivery) => delivery.postIndex))],
    Array.from({ length: 31 }, (_, i) => i),
  );
  const conflict = await request("/api/posts", {
    cookie: admin.cookie,
    body: {
      ...body,
      additionalPosts: [{ text: "Different second post", mediaIds: [] }],
    },
  });
  assert.equal(conflict.status, 409);
});

test("single-post request keys from before the sequence migration still replay", async () => {
  const admin = await setupUser();
  const body = input([await account()], 0);
  const post = await create(admin.cookie, body);
  const legacyHash = createHash("sha256")
    .update(
      JSON.stringify({
        text: body.text,
        connectionIds: [...body.connectionIds].sort(),
        mediaIds: body.mediaIds,
        scheduledAt: body.scheduledAt,
        idempotencyKey: body.idempotencyKey,
      }),
    )
    .digest("hex");
  await sql`UPDATE post_groups SET request_hash=${legacyHash} WHERE id=${post.id}`;
  const { additionalPosts: _, ...legacyRequest } = body;
  const replay = await request("/api/posts", {
    cookie: admin.cookie,
    body: legacyRequest,
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).post.id, post.id);
  assert.equal((await sql`SELECT id FROM post_deliveries`).length, 1);
});

test("draft and scheduled edits retain each post's own media, overrides and order", async () => {
  const admin = await setupUser();
  const id = await account();
  const mediaIds = [randomUUID(), randomUUID()];
  for (const media of mediaIds)
    await sql`INSERT INTO post_media(id,workspace_id,created_by,object_key,file_name,content_type,size_bytes,width,height,state) VALUES(${media},(SELECT id FROM workspace),${admin.user.id},${`sequences/${media}.png`},'sample.png','image/png',10,40,40,'ready')`;
  const body = {
    ...input([id], 1),
    mediaIds: [mediaIds[0]],
    additionalPosts: [
      {
        text: "Second shared text",
        textOverrides: { [id]: "Second custom text" },
        mediaIds: [mediaIds[1], mediaIds[0]],
      },
    ],
  };
  const draftId = randomUUID();
  const draftBody = {
    text: body.text,
    mediaIds: body.mediaIds,
    additionalPosts: body.additionalPosts,
    connectionIds: [id],
    version: 0,
    idempotencyKey: randomUUID(),
  };
  const saved = await request(`/api/drafts/${draftId}`, {
    cookie: admin.cookie,
    body: draftBody,
  });
  assert.equal(saved.status, 201);
  const draft: PostDraft = (await saved.json()).draft;
  assert.deepEqual(
    draft.media.map((media) => media.id),
    [mediaIds[0]],
  );
  assert.deepEqual(
    draft.additionalPosts[0].media.map((media) => media.id),
    [mediaIds[1], mediaIds[0]],
  );
  assert.equal(
    draft.additionalPosts[0].textOverrides[id],
    "Second custom text",
  );
  assert.equal((await sql`SELECT id FROM post_deliveries`).length, 0);
  const post = await create(admin.cookie, {
    ...body,
    draftSource: { id: draftId, version: 1 },
  });
  assert.deepEqual(
    post.additionalPosts[0].media.map((media) => media.id),
    [mediaIds[1], mediaIds[0]],
  );
  assert.equal(post.deliveries[1].textOverride, "Second custom text");
  const changed = {
    ...body,
    additionalPosts: [
      { text: "Edited second", textOverrides: {}, mediaIds: [mediaIds[0]] },
    ],
    version: post.version,
    idempotencyKey: randomUUID(),
  };
  const edit = await request(`/api/posts/${post.id}`, {
    cookie: admin.cookie,
    method: "PATCH",
    body: changed,
  });
  assert.equal(edit.status, 200);
  assert.equal(
    (await edit.json()).post.additionalPosts[0].text,
    "Edited second",
  );
  assert.equal(
    (
      await request(`/api/posts/${post.id}`, {
        cookie: admin.cookie,
        method: "PATCH",
        body: { ...changed, idempotencyKey: randomUUID() },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/api/posts/${post.id}`, {
        cookie: admin.cookie,
        method: "DELETE",
      })
    ).status,
    200,
  );
  assert.ok(
    (await sql`SELECT state FROM post_deliveries`).every(
      (delivery) => delivery.state === "cancelled",
    ),
  );
});

test("every post validates content, selected overrides and permissions before any delivery is created", async () => {
  const admin = await setupUser();
  const id = await account();
  for (const part of [
    { text: "", mediaIds: [] },
    { text: "x".repeat(281), mediaIds: [] },
    {
      text: "Second",
      textOverrides: { [randomUUID()]: "forged account" },
      mediaIds: [],
    },
    { text: "Second", mediaIds: [randomUUID()] },
  ]) {
    const result = await request("/api/posts", {
      cookie: admin.cookie,
      body: { ...input([id]), additionalPosts: [part] },
    });
    assert.equal(result.status, 400);
  }
  assert.equal((await sql`SELECT id FROM post_groups`).length, 0);
  await sql`UPDATE users SET role='viewer' WHERE id=${admin.user.id}`;
  const login = await request("/api/auth/login", {
    body: {
      email: "admin@example.test",
      password: "Secure test passphrase 42!",
    },
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  assert.equal(
    (await request("/api/posts", { cookie, body: input([id]) })).status,
    403,
  );
  assert.equal(
    (
      await request(`/api/drafts/${randomUUID()}`, {
        cookie,
        body: {
          text: "",
          mediaIds: [],
          connectionIds: [],
          additionalPosts: [{ text: "", mediaIds: [] }],
          version: 0,
          idempotencyKey: randomUUID(),
        },
      })
    ).status,
    403,
  );
});

test("competing claims serialize each account's sequence and a failed predecessor stops only its descendants", async () => {
  const admin = await setupUser();
  const x = await account();
  const linkedin = await account("linkedin");
  await create(admin.cookie, input([x, linkedin]));
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
  const claims = (
    await Promise.all([claimDelivery(), claimDelivery(), claimDelivery()])
  ).filter((job) => job !== null);
  assert.ok(claims.length > 0);
  assert.ok(claims.every((job) => job.postIndex === 0));
  // A group lock may defer the other account, but no reply can bypass its parent.
  while (claims.length < 2) {
    const job = await claimDelivery();
    assert.ok(job);
    claims.push(job);
  }
  const first = claims.find((job) => job.connectionId === x);
  const other = claims.find((job) => job.connectionId === linkedin);
  assert.ok(first && other);
  assert.equal(await publishingBoundary(first), true);
  await completeDelivery(first, {
    id: "x-root",
    url: "https://x.com/i/status/x-root",
  });
  const second = await claimDelivery();
  assert.ok(second);
  assert.equal(second.postIndex, 1);
  assert.equal(second.replyTo?.id, "x-root");
  await failDelivery(second, "Definitive rejection", false);
  assert.equal(await publishingBoundary(other), true);
  await completeDelivery(other, {
    id: "linkedin-root",
    url: "https://www.linkedin.com/feed/update/root/",
  });
  const independent = await claimDelivery();
  assert.ok(independent);
  assert.equal(independent.connectionId, linkedin);
  assert.equal(independent.replyTo, undefined);
  assert.equal(independent.text, "Post 2");
  const descendants =
    await sql`SELECT state FROM post_deliveries WHERE connection_id=${x} ORDER BY post_index`;
  assert.deepEqual(
    descendants.map((delivery) => delivery.state),
    ["published", "failed", "failed"],
  );
});

test("worker publishes X replies once, keeps partial results and stops after a lost response", async () => {
  const admin = await setupUser();
  const id = await account("x", admin.user.id);
  const body = input([id]);
  const post = await create(admin.cookie, body);
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
  const payloads: Record<string, unknown>[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (target: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(target), "https://api.x.com/2/tweets");
      payloads.push(JSON.parse(String(init?.body)));
      if (payloads.length === 2)
        throw new Error("Lost response after external acceptance");
      return Response.json({ data: { id: "confirmed-root" } });
    },
  );
  assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), false);
  assert.deepEqual(payloads, [
    { text: "First post" },
    { text: "Post 2", reply: { in_reply_to_tweet_id: "confirmed-root" } },
  ]);
  const read: Post = (
    await (
      await request(`/api/posts/${post.id}`, { cookie: admin.cookie })
    ).json()
  ).post;
  assert.equal(read.state, "uncertain");
  assert.deepEqual(
    read.deliveries.map((delivery) => delivery.state),
    ["published", "uncertain", "failed"],
  );
  assert.equal(
    (await request("/api/posts", { cookie: admin.cookie, body })).status,
    200,
  );
  assert.equal(await deliverNext(), false);
  const summary: SocialConnectionSummary = (
    await (await request("/api/connections", { cookie: admin.cookie })).json()
  ).items[0];
  assert.equal(summary.connectedBy?.id, admin.user.id);
  assert.equal(summary.lastPublished?.postId, post.id);
  assert.equal(summary.scheduledCount, 0);
  assert.ok(!JSON.stringify(summary).includes("admin@example.test"));
});

test("successful multi-account sequences use every predecessor for X and separate LinkedIn publications", async () => {
  const admin = await setupUser();
  const post = await create(
    admin.cookie,
    input([await account(), await account("linkedin")]),
  );
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
  const tweets: Record<string, unknown>[] = [];
  const standalone: Record<string, unknown>[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (target: string | URL | Request, init?: RequestInit) => {
      if (String(target) === "https://api.x.com/2/tweets") {
        tweets.push(JSON.parse(String(init?.body)));
        return Response.json({ data: { id: `tweet-${tweets.length}` } });
      }
      assert.equal(String(target), "https://api.linkedin.com/rest/posts");
      standalone.push(JSON.parse(String(init?.body)));
      return new Response(null, {
        status: 201,
        headers: { "x-restli-id": `urn:li:share:${standalone.length}` },
      });
    },
  );
  for (let i = 0; i < 6; i++) assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), false);
  assert.deepEqual(
    tweets.map((tweet) => tweet.reply),
    [
      undefined,
      { in_reply_to_tweet_id: "tweet-1" },
      { in_reply_to_tweet_id: "tweet-2" },
    ],
  );
  assert.deepEqual(
    standalone.map((entry) => entry.commentary),
    ["First post", "Post 2", "Post 3"],
  );
  assert.ok(standalone.every((entry) => entry.reply === undefined));
  const loaded: Post = (
    await (
      await request(`/api/posts/${post.id}`, { cookie: admin.cookie })
    ).json()
  ).post;
  assert.equal(loaded.state, "published");
  assert.ok(
    loaded.deliveries.every(
      (delivery) => delivery.publishedAt && delivery.providerPostId,
    ),
  );
});

test("expired publishing leases never release later posts and preparation leases recover safely", async () => {
  const admin = await setupUser();
  await create(admin.cookie, input([await account()]));
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
  const original = await claimDelivery();
  assert.ok(original);
  await sql`UPDATE post_deliveries SET lease_until=now()-interval '1 second' WHERE id=${original.id}`;
  assert.equal(await claimDelivery(), null);
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second' WHERE id=${original.id}`;
  const recovered = await claimDelivery();
  assert.ok(recovered);
  assert.equal(recovered.id, original.id);
  assert.notEqual(recovered.leaseToken, original.leaseToken);
  assert.equal(await publishingBoundary(original), false);
  assert.equal(await publishingBoundary(recovered), true);
  await sql`UPDATE post_deliveries SET lease_until=now()-interval '1 second' WHERE id=${recovered.id}`;
  assert.equal(await claimDelivery(), null);
  assert.deepEqual(
    (await sql`SELECT state FROM post_deliveries ORDER BY post_index`).map(
      (row) => row.state,
    ),
    ["uncertain", "failed", "failed"],
  );
});

test("Threads sends a reply target while LinkedIn creates independent posts", async () => {
  const calls: { url: string; body: string }[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (target: string | URL | Request, init?: RequestInit) => {
      const url = String(target);
      calls.push({ url, body: String(init?.body ?? "") });
      if (url.endsWith("/threads")) return Response.json({ id: "container" });
      if (url.endsWith("/container?fields=id,status"))
        return Response.json({ status: "FINISHED" });
      if (url.endsWith("/threads_publish"))
        return Response.json({ id: "reply" });
      if (url.endsWith("/reply?fields=permalink"))
        return Response.json({
          permalink: "https://www.threads.net/@example/post/reply",
        });
      if (url === "https://api.linkedin.com/rest/posts")
        return new Response(null, {
          status: 201,
          headers: { "x-restli-id": "urn:li:share:second" },
        });
      throw new Error("Unexpected provider request");
    },
  );
  const job = {
    id: randomUUID(),
    groupId: randomUUID(),
    workspaceId: randomUUID(),
    connectionId: randomUUID(),
    leaseToken: randomUUID(),
    text: "Second post",
    accountId: "fixture-account",
    encryptedCredentials: "",
    postIndex: 1,
    replyTo: { id: "root", cid: null },
    threadRoot: { id: "root", cid: null },
  };
  const prepared = await preparePublication(
    { ...job, provider: "threads" },
    [],
    "disposable-token",
  );
  assert.equal(new URLSearchParams(calls[0].body).get("reply_to_id"), "root");
  await prepared.publish();
  const standalone = await preparePublication(
    { ...job, provider: "linkedin" },
    [],
    "disposable-token",
  );
  await standalone.publish();
  const last = calls.at(-1);
  assert.ok(last);
  const linkedInBody = JSON.parse(last.body);
  assert.equal(linkedInBody.commentary, "Second post");
  assert.equal(linkedInBody.reply, undefined);
});

test("account media overrides retain empty selections and order across drafts, publication requests and reset", async () => {
  const admin = await setupUser();
  const x = await account();
  const linkedin = await account("linkedin");
  const images = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of images)
    await sql`INSERT INTO post_media(id,workspace_id,created_by,object_key,file_name,content_type,size_bytes,width,height,state) VALUES(${id},(SELECT id FROM workspace),${admin.user.id},${`account-media/${id}.png`},'sample.png','image/png',10,40,40,'ready')`;
  const body = {
    ...input([x, linkedin], 0),
    mediaIds: [images[0]],
    mediaOverrides: { [x]: [images[2], images[0]], [linkedin]: [] },
    additionalPosts: [
      {
        text: "Reply",
        mediaIds: [images[0]],
        mediaOverrides: { [x]: [images[1]] },
      },
    ],
  };
  const draftId = randomUUID();
  const draftBody = { ...body, scheduledAt: undefined, version: 0 };
  const saved = await request(`/api/drafts/${draftId}`, {
    cookie: admin.cookie,
    body: draftBody,
  });
  assert.equal(saved.status, 201);
  const draft: PostDraft = (await saved.json()).draft;
  assert.deepEqual(
    draft.media.map((item) => item.id),
    [images[0]],
  );
  assert.deepEqual(
    draft.mediaOverrides[x].map((item) => item.id),
    [images[2], images[0]],
  );
  assert.deepEqual(draft.mediaOverrides[linkedin], []);
  assert.deepEqual(
    draft.additionalPosts[0].mediaOverrides[x].map((item) => item.id),
    [images[1]],
  );
  const replay = await request(`/api/drafts/${draftId}`, {
    cookie: admin.cookie,
    body: draftBody,
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).draft.version, 1);
  assert.equal(
    (
      await request(`/api/drafts/${draftId}`, {
        cookie: admin.cookie,
        body: {
          ...draftBody,
          mediaOverrides: { [x]: [images[0], images[2]], [linkedin]: [] },
        },
      })
    ).status,
    409,
  );
  const post = await create(admin.cookie, {
    ...body,
    draftSource: { id: draftId, version: 1 },
  });
  assert.deepEqual(
    post.mediaOverrides[x].map((item) => item.id),
    [images[2], images[0]],
  );
  assert.deepEqual(post.mediaOverrides[linkedin], []);
  assert.deepEqual(
    post.additionalPosts[0].mediaOverrides[x].map((item) => item.id),
    [images[1]],
  );
  await assert.rejects(
    sql`DELETE FROM post_media WHERE id=${images[2]}`,
    /foreign key/,
  );
  assert.equal(
    (
      await request("/api/posts", {
        cookie: admin.cookie,
        body: {
          ...body,
          draftSource: { id: draftId, version: 1 },
          mediaOverrides: { [x]: [], [linkedin]: [] },
        },
      })
    ).status,
    409,
  );
  const reset = await request(`/api/posts/${post.id}`, {
    cookie: admin.cookie,
    method: "PATCH",
    body: {
      ...body,
      mediaOverrides: {},
      additionalPosts: [{ text: "Reply", mediaIds: [images[0]] }],
      version: post.version,
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(reset.status, 200);
  const restored: Post = (await reset.json()).post;
  assert.deepEqual(restored.mediaOverrides, {});
  assert.deepEqual(restored.additionalPosts[0].mediaOverrides, {});
  assert.deepEqual(
    restored.media.map((item) => item.id),
    [images[0]],
  );
  assert.equal((await sql`SELECT * FROM post_group_media_overrides`).length, 0);
});

test("account media enforces selected accounts, ready team-owned files, uniqueness, limits and permissions", async () => {
  const admin = await setupUser();
  const id = await account();
  const ready = randomUUID();
  const processing = randomUUID();
  for (const [mediaId, state] of [
    [ready, "ready"],
    [processing, "processing"],
  ])
    await sql`INSERT INTO post_media(id,workspace_id,object_key,file_name,content_type,size_bytes,width,height,state) VALUES(${mediaId},(SELECT id FROM workspace),${`account-guard/${mediaId}`},'guard.png','image/png',10,40,40,${state})`;
  const base = { ...input([id], 0), mediaIds: [ready] };
  for (const mediaOverrides of [
    { [randomUUID()]: [ready] },
    { [id]: [randomUUID()] },
    { [id]: [processing] },
    { [id]: [ready, ready] },
    { [id]: Array.from({ length: 21 }, () => randomUUID()) },
  ]) {
    assert.equal(
      (
        await request("/api/posts", {
          cookie: admin.cookie,
          body: { ...base, mediaOverrides },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(`/api/drafts/${randomUUID()}`, {
          cookie: admin.cookie,
          body: { ...base, scheduledAt: undefined, mediaOverrides, version: 0 },
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await request("/api/posts", {
        cookie: admin.cookie,
        body: { ...base, text: "", mediaOverrides: { [id]: [] } },
      })
    ).status,
    400,
  );
  assert.equal((await sql`SELECT id FROM post_groups`).length, 0);
  assert.equal((await sql`SELECT id FROM post_drafts`).length, 0);
  await sql`UPDATE users SET role='viewer' WHERE id=${admin.user.id}`;
  const login = await request("/api/auth/login", {
    body: {
      email: "admin@example.test",
      password: "Secure test passphrase 42!",
    },
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  assert.equal(
    (
      await request("/api/posts", {
        cookie,
        body: { ...base, mediaOverrides: { [id]: [] } },
      })
    ).status,
    403,
  );
});
