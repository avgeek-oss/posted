import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  sql,
  request,
  setupUser,
  resetDatabase,
  cleanupDatabase,
  setupSecret,
} from "./support.js";
import {
  claimDelivery,
  publishingBoundary,
  completeDelivery,
} from "../apps/api/src/posts/queue.js";
import { postState } from "../apps/api/src/posts/state.js";
import type { Page, Post, Provider } from "../packages/contracts/src/index.js";

beforeEach(resetDatabase);
after(cleanupDatabase);
async function connection(
  provider: Provider = "x",
  accountId: string = randomUUID(),
) {
  const [row] = await sql<
    { id: string }[]
  >`INSERT INTO social_connections(workspace_id,provider,account_id,name,handle,encrypted_credentials) VALUES((SELECT id FROM workspace),${provider},${accountId},'Example account','example','test-encrypted-fixture') RETURNING id`;
  return row.id;
}
function input(connectionIds: string[]) {
  return {
    text: "A post shared with our team",
    connectionIds,
    mediaIds: [],
    scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    idempotencyKey: randomUUID(),
  };
}

async function editor(adminId: string) {
  const id = randomUUID();
  await sql`INSERT INTO users(id,workspace_id,name,email,password_hash,email_verified,role)
    SELECT ${id},workspace_id,'Team editor','editor@example.test',password_hash,true,'member'
    FROM users WHERE id=${adminId}`;
  const login = await request("/api/auth/login", {
    body: {
      email: "editor@example.test",
      password: "Secure test passphrase 42!",
    },
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return { id, cookie };
}

test("last editor follows successful saves without changing on retries or rejected edits", async () => {
  const admin = await setupUser();
  const member = await editor(admin.user.id);
  const connectionId = await connection();
  const avatarUrl = "https://example.test/account-avatar.jpg";
  await sql`UPDATE social_connections SET avatar_url=${avatarUrl} WHERE id=${connectionId}`;
  const body = input([connectionId]);
  const created = await request("/api/posts", { cookie: admin.cookie, body });
  assert.equal(created.status, 201);
  const { post } = (await created.json()) as { post: Post };
  assert.equal(post.managedBy?.id, admin.user.id);
  assert.equal(post.deliveries[0].accountAvatarUrl, avatarUrl);
  const changed = {
    ...body,
    text: "Edited by a team member",
    version: 1,
    idempotencyKey: randomUUID(),
  };
  const saved = await request(`/api/posts/${post.id}`, {
    cookie: member.cookie,
    method: "PATCH",
    body: changed,
  });
  assert.equal(saved.status, 200);
  const updated: Post = (await saved.json()).post;
  assert.deepEqual(updated.managedBy, {
    id: member.id,
    name: "Team editor",
    avatarUrl: `https://www.gravatar.com/avatar/${createHash("sha256").update("editor@example.test").digest("hex")}?s=160&d=404&r=g`,
  });
  assert.equal(JSON.stringify(updated).includes("editor@example.test"), false);
  const replay = await request(`/api/posts/${post.id}`, {
    cookie: admin.cookie,
    method: "PATCH",
    body: changed,
  });
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).post.managedBy, updated.managedBy);
  const stale = await request(`/api/posts/${post.id}`, {
    cookie: admin.cookie,
    method: "PATCH",
    body: { ...changed, idempotencyKey: randomUUID() },
  });
  assert.equal(stale.status, 409);
  const forged = await request(`/api/posts/${post.id}`, {
    cookie: admin.cookie,
    method: "PATCH",
    body: {
      ...changed,
      version: 2,
      idempotencyKey: randomUUID(),
      managedBy: { id: admin.user.id },
    },
  });
  assert.equal(forged.status, 400);
  const current: Post = (
    await (
      await request(`/api/posts/${post.id}`, { cookie: admin.cookie })
    ).json()
  ).post;
  assert.deepEqual(current.managedBy, updated.managedBy);
  assert.equal(current.version, 2);
});

test("cancellation records the responsible person without transferring ownership on a repeated cancellation", async () => {
  const admin = await setupUser();
  const member = await editor(admin.user.id);
  const created = await request("/api/posts", {
    cookie: admin.cookie,
    body: input([await connection()]),
  });
  const { post } = (await created.json()) as { post: Post };
  const cancelled = await request(`/api/posts/${post.id}`, {
    cookie: member.cookie,
    method: "DELETE",
  });
  assert.equal(cancelled.status, 200);
  const updated: Post = (await cancelled.json()).post;
  assert.equal(updated.managedBy?.id, member.id);
  assert.equal(updated.version, 2);
  const replay = await request(`/api/posts/${post.id}`, {
    cookie: admin.cookie,
    method: "DELETE",
  });
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).post, updated);
});

test("editor migration attributes untouched legacy sets but does not invent the editor of previously edited sets", async () => {
  const admin = await setupUser();
  const id = await connection();
  const first: Post = (
    await (
      await request("/api/posts", { cookie: admin.cookie, body: input([id]) })
    ).json()
  ).post;
  const changed: Post = (
    await (
      await request("/api/posts", { cookie: admin.cookie, body: input([id]) })
    ).json()
  ).post;
  await sql`UPDATE post_groups SET version=2 WHERE id=${changed.id}`;
  const cancelled: Post = (
    await (
      await request("/api/posts", { cookie: admin.cookie, body: input([id]) })
    ).json()
  ).post;
  await sql`UPDATE post_groups SET cancelled_at=now() WHERE id=${cancelled.id}`;
  await sql`ALTER TABLE post_groups DROP COLUMN last_edited_by`;
  await sql.unsafe(
    await readFile(
      new URL(
        "../packages/database/migrations/006_post_editors.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const untouched: Post = (
    await (
      await request(`/api/posts/${first.id}`, { cookie: admin.cookie })
    ).json()
  ).post;
  const edited: Post = (
    await (
      await request(`/api/posts/${changed.id}`, { cookie: admin.cookie })
    ).json()
  ).post;
  assert.equal(untouched.managedBy?.id, admin.user.id);
  assert.equal(edited.managedBy, null);
  const previousCancellation: Post = (
    await (
      await request(`/api/posts/${cancelled.id}`, { cookie: admin.cookie })
    ).json()
  ).post;
  assert.equal(previousCancellation.managedBy, null);
});

test("sidebar totals count delivery sets and unpublished drafts across publishing and cancellation", async () => {
  assert.equal((await request("/api/posts/counts")).status, 401);
  const admin = await setupUser();
  const counts = async () => {
    const response = await request("/api/posts/counts", {
      cookie: admin.cookie,
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.deepEqual(await counts(), { scheduled: 0, drafts: 0 });
  const drafts = [randomUUID(), randomUUID()];
  for (const id of drafts) {
    const saved = await request(`/api/drafts/${id}`, {
      cookie: admin.cookie,
      body: {
        text: "",
        textOverrides: {},
        connectionIds: [],
        mediaIds: [],
        version: 0,
        idempotencyKey: randomUUID(),
      },
    });
    assert.equal(saved.status, 201);
  }
  assert.deepEqual(await counts(), { scheduled: 0, drafts: 2 });
  const page = await (
    await request("/api/drafts?pageSize=1", { cookie: admin.cookie })
  ).json();
  assert.equal(page.items.length, 1);
  assert.equal(page.total, 2);
  const created = await request("/api/posts", {
    cookie: admin.cookie,
    body: {
      ...input([await connection(), await connection()]),
      draftSource: { id: drafts[0], version: 1 },
    },
  });
  assert.equal(created.status, 201);
  const { post } = (await created.json()) as { post: Post };
  assert.equal(post.deliveries.length, 2);
  assert.deepEqual(await counts(), { scheduled: 1, drafts: 1 });
  await sql`UPDATE post_deliveries SET state='preparing' WHERE id=${post.deliveries[0].id}`;
  await sql`UPDATE post_deliveries SET state='published' WHERE id=${post.deliveries[1].id}`;
  assert.deepEqual(await counts(), { scheduled: 1, drafts: 1 });
  await sql`UPDATE post_deliveries SET state='publishing' WHERE id=${post.deliveries[0].id}`;
  assert.deepEqual(await counts(), { scheduled: 1, drafts: 1 });
  await sql`UPDATE post_deliveries SET state='published' WHERE group_id=${post.id}`;
  assert.deepEqual(await counts(), { scheduled: 0, drafts: 1 });
  const second = await request("/api/posts", {
    cookie: admin.cookie,
    body: input([await connection()]),
  });
  const secondPost: Post = (await second.json()).post;
  assert.deepEqual(await counts(), { scheduled: 1, drafts: 1 });
  assert.equal(
    (
      await request(`/api/posts/${secondPost.id}`, {
        cookie: admin.cookie,
        method: "DELETE",
      })
    ).status,
    200,
  );
  assert.deepEqual(await counts(), { scheduled: 0, drafts: 1 });
  assert.equal(
    (
      await request(`/api/drafts/${drafts[1]}`, {
        cookie: admin.cookie,
        method: "DELETE",
        body: { version: 1 },
      })
    ).status,
    200,
  );
  await sql`UPDATE users SET role='viewer' WHERE id=${admin.user.id}`;
  assert.deepEqual(await counts(), { scheduled: 0, drafts: 0 });
});

test("the first administrator needs the installation secret and is verified without email", async () => {
  const invalid = await request("/api/auth/setup", {
    body: {
      setupSecret: "incorrect",
      workspaceName: "Team",
      name: "Admin",
      email: "admin@example.test",
      password: "Secure test passphrase 42!",
    },
  });
  assert.equal(invalid.status, 403);
  const admin = await setupUser();
  assert.equal(admin.user.emailVerified, true);
  assert.equal((await sql`SELECT id FROM email_outbox`).length, 0);
  assert.equal(
    (await request("/api/auth/me", { cookie: admin.cookie })).status,
    200,
  );
  const replay = await request("/api/auth/setup", {
    body: {
      setupSecret,
      workspaceName: "Another team",
      name: "Admin",
      email: "admin@example.test",
      password: "Secure test passphrase 42!",
    },
  });
  assert.equal(replay.status, 409);
});

test("concurrent posting requests use a single team-owned group and reject changed content", async () => {
  const admin = await setupUser();
  const first = await connection();
  const second = await connection();
  const body = input([first, second]);
  const responses = await Promise.all([
    request("/api/posts", { cookie: admin.cookie, body }),
    request("/api/posts", { cookie: admin.cookie, body }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
  assert.equal((await sql`SELECT id FROM post_groups`).length, 1);
  assert.equal((await sql`SELECT id FROM post_deliveries`).length, 2);
  const conflict = await request("/api/posts", {
    cookie: admin.cookie,
    body: { ...body, text: "Different content" },
  });
  assert.equal(conflict.status, 409);
  const sortedReplay = await request("/api/posts", {
    cookie: admin.cookie,
    body: { ...body, connectionIds: [second, first] },
  });
  assert.equal(sortedReplay.status, 200);
});

test("viewer cannot schedule or disconnect accounts, member can schedule but cannot disconnect", async () => {
  const admin = await setupUser();
  const id = await connection();
  await sql`UPDATE users SET role='viewer' WHERE id=${admin.user.id}`;
  assert.equal(
    (await request("/api/posts", { cookie: admin.cookie, body: input([id]) }))
      .status,
    403,
  );
  assert.equal(
    (
      await request(`/api/connections/${id}`, {
        cookie: admin.cookie,
        method: "DELETE",
      })
    ).status,
    403,
  );
  await sql`UPDATE users SET role='member' WHERE id=${admin.user.id}`;
  assert.equal(
    (await request("/api/posts", { cookie: admin.cookie, body: input([id]) }))
      .status,
    201,
  );
  assert.equal(
    (
      await request(`/api/connections/${id}`, {
        cookie: admin.cookie,
        method: "DELETE",
      })
    ).status,
    403,
  );
});

test("disconnecting Bluesky removes its OAuth session and prevents a prepared delivery from publishing", async () => {
  const admin = await setupUser();
  const accountId = "did:plc:disposableaccount";
  const id = await connection("bluesky", accountId);
  const otherId = await connection("bluesky", "did:plc:otheraccount");
  await sql`INSERT INTO bluesky_oauth_sessions(key,value) VALUES(${accountId},'encrypted-session'),('did:plc:otheraccount','other-encrypted-session')`;
  const created = await request("/api/posts", {
    cookie: admin.cookie,
    body: input([id]),
  });
  assert.equal(created.status, 201);
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
  const job = await claimDelivery();
  assert.ok(job);
  const disconnected = await request(`/api/connections/${id}`, {
    cookie: admin.cookie,
    method: "DELETE",
  });
  assert.equal(disconnected.status, 200);
  assert.equal(await publishingBoundary(job), false);
  assert.equal(
    (await sql`SELECT key FROM bluesky_oauth_sessions WHERE key=${accountId}`)
      .length,
    0,
  );
  assert.equal(
    (
      await sql`SELECT key FROM bluesky_oauth_sessions WHERE key='did:plc:otheraccount'`
    ).length,
    1,
  );
  const [removed] =
    await sql`SELECT state,encrypted_credentials FROM social_connections WHERE id=${id}`;
  assert.equal(removed.state, "disconnected");
  assert.equal(removed.encryptedCredentials, "");
  assert.equal(
    (await sql`SELECT state FROM social_connections WHERE id=${otherId}`)[0]
      .state,
    "connected",
  );
});

test("editing checks the version and rejects an edit once a worker owns a delivery", async () => {
  const admin = await setupUser();
  const id = await connection();
  const body = input([id]);
  const created = await request("/api/posts", { cookie: admin.cookie, body });
  const { post } = await created.json();
  const changed = { ...body, text: "Changed draft", version: 1 };
  assert.equal(
    (
      await request(`/api/posts/${post.id}`, {
        cookie: admin.cookie,
        method: "PATCH",
        body: changed,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/api/posts/${post.id}`, {
        cookie: admin.cookie,
        method: "PATCH",
        body: changed,
      })
    ).status,
    200,
  );
  const stale = await request(`/api/posts/${post.id}`, {
    cookie: admin.cookie,
    method: "PATCH",
    body: { ...changed, idempotencyKey: randomUUID() },
  });
  assert.equal(stale.status, 409);
  assert.equal((await sql`SELECT version FROM post_groups`)[0].version, 2);
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
  const job = await claimDelivery();
  assert.ok(job);
  assert.equal(
    (
      await request(`/api/posts/${post.id}`, {
        cookie: admin.cookie,
        method: "PATCH",
        body: { ...changed, version: 2, idempotencyKey: randomUUID() },
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
    409,
  );
  assert.equal(
    (await sql`SELECT text FROM post_groups`)[0].text,
    "Changed draft",
  );
});

test("only one worker claims each delivery; expired publishing is uncertain and never re-queued", async () => {
  const admin = await setupUser();
  const id = await connection();
  const body = input([id]);
  body.scheduledAt = new Date().toISOString();
  assert.equal(
    (await request("/api/posts", { cookie: admin.cookie, body })).status,
    201,
  );
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
  const claims = await Promise.all([claimDelivery(), claimDelivery()]);
  assert.equal(claims.filter(Boolean).length, 1);
  const job = claims.find(Boolean);
  assert.ok(job);
  await sql`UPDATE post_deliveries SET lease_until=now()-interval '1 second'`;
  const recovered = await claimDelivery();
  assert.equal(recovered, null);
  assert.equal(
    (await sql`SELECT state FROM post_deliveries`)[0].state,
    "scheduled",
  );
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
  const retried = await claimDelivery();
  assert.ok(retried);
  assert.notEqual(retried.leaseToken, job.leaseToken);
  assert.equal(await publishingBoundary(job), false);
  assert.equal(await publishingBoundary(retried), true);
  await sql`UPDATE post_deliveries SET lease_until=now()-interval '1 second'`;
  assert.equal(await claimDelivery(), null);
  assert.equal(
    (await sql`SELECT state FROM post_deliveries`)[0].state,
    "uncertain",
  );
});

test("published results are visible in history and removed from the scheduled list", async () => {
  const admin = await setupUser();
  const id = await connection();
  const body = input([id]);
  body.scheduledAt = new Date().toISOString();
  await request("/api/posts", { cookie: admin.cookie, body });
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
  const job = await claimDelivery();
  assert.ok(job);
  assert.equal(await publishingBoundary(job), true);
  await completeDelivery(job, {
    id: "published-1",
    url: "https://x.com/example/status/1",
  });
  const scheduled = await (
    await request("/api/posts?view=scheduled", { cookie: admin.cookie })
  ).json();
  assert.equal(scheduled.total, 0);
  const history = await (
    await request("/api/posts?view=history", { cookie: admin.cookie })
  ).json();
  assert.equal(history.total, 1);
  assert.equal(history.items[0].state, "published");
  assert.equal(history.items[0].managedBy.id, admin.user.id);
  assert.equal(
    history.items[0].deliveries[0].publishedUrl,
    "https://x.com/example/status/1",
  );
  assert.equal(postState(["published", "failed"]), "partial");
  assert.equal(postState(["published", "uncertain"]), "uncertain");
});

test("scheduled pagination retains every request and cancellation moves only the selected request to history", async () => {
  const admin = await setupUser();
  const id = await connection();
  const createdIds: string[] = [];
  for (let index = 0; index < 22; index++) {
    const created = await request("/api/posts", {
      cookie: admin.cookie,
      body: { ...input([id]), text: `Scheduled request ${index}` },
    });
    assert.equal(created.status, 201);
    createdIds.push((await created.json()).post.id);
  }
  const page = async (number: number): Promise<Page<Post>> => {
    const result = await request(`/api/posts?view=scheduled&page=${number}`, {
      cookie: admin.cookie,
    });
    assert.equal(result.status, 200);
    return result.json();
  };
  const first = await page(1);
  const second = await page(2);
  assert.equal(first.total, 22);
  assert.equal(first.pageSize, 20);
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 2);
  assert.deepEqual(
    new Set([...first.items, ...second.items].map((post) => post.id)),
    new Set(createdIds),
  );
  const selected = second.items[0];
  assert.ok(selected);
  await sql`UPDATE users SET role='viewer' WHERE id=${admin.user.id}`;
  assert.equal(
    (
      await request(`/api/posts/${selected.id}`, {
        cookie: admin.cookie,
        method: "DELETE",
      })
    ).status,
    403,
  );
  await sql`UPDATE users SET role='admin' WHERE id=${admin.user.id}`;
  const cancelled = await request(`/api/posts/${selected.id}`, {
    cookie: admin.cookie,
    method: "DELETE",
  });
  assert.equal(cancelled.status, 200);
  const cancelledPost: Post = (await cancelled.json()).post;
  assert.equal(cancelledPost.state, "cancelled");
  assert.ok(
    cancelledPost.deliveries.every(
      (delivery) => delivery.state === "cancelled",
    ),
  );
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second' WHERE group_id=${selected.id}`;
  assert.equal(await claimDelivery(), null);
  const remaining = await page(99);
  assert.equal(remaining.page, 2);
  assert.equal(remaining.total, 21);
  assert.equal(remaining.items.length, 1);
  const history: Page<Post> = await (
    await request("/api/posts?view=history", { cookie: admin.cookie })
  ).json();
  assert.equal(history.total, 1);
  assert.ok(history.items[0]);
  assert.equal(history.items[0].id, selected.id);
  assert.equal(history.items[0].state, "cancelled");
});

test("account text is validated, persisted and claimed separately from the master text", async () => {
  const admin = await setupUser();
  const x = await connection("x");
  const linkedIn = await connection("linkedin");
  const body = {
    ...input([x, linkedIn]),
    text: "Master text ".repeat(30),
    textOverrides: { [x]: "A shorter post for X" },
  };
  const created = await request("/api/posts", { cookie: admin.cookie, body });
  assert.equal(created.status, 201);
  const { post } = (await created.json()) as { post: Post };
  assert.equal(post.text, body.text);
  assert.equal(
    post.deliveries.find((delivery) => delivery.connectionId === x)
      ?.textOverride,
    body.textOverrides[x],
  );
  assert.equal(
    post.deliveries.find((delivery) => delivery.connectionId === linkedIn)
      ?.textOverride,
    null,
  );
  const replay = await request("/api/posts", {
    cookie: admin.cookie,
    body: { ...body, connectionIds: [linkedIn, x] },
  });
  assert.equal(replay.status, 200);
  const conflict = await request("/api/posts", {
    cookie: admin.cookie,
    body: { ...body, textOverrides: { [x]: "Changed custom text" } },
  });
  assert.equal(conflict.status, 409);
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
  const jobs = [await claimDelivery(), await claimDelivery()];
  assert.equal(
    jobs.find((job) => job?.connectionId === x)?.text,
    body.textOverrides[x],
  );
  assert.equal(
    jobs.find((job) => job?.connectionId === linkedIn)?.text,
    body.text,
  );
});

test("scheduled edits can change or remove custom text and reject invalid account overrides", async () => {
  const admin = await setupUser();
  const id = await connection();
  const other = await connection();
  const body = input([id]);
  for (const textOverrides of [
    { [id]: "界".repeat(141) },
    { [id]: "" },
    { [other]: "Not selected" },
  ]) {
    const invalid = await request("/api/posts", {
      cookie: admin.cookie,
      body: { ...body, idempotencyKey: randomUUID(), textOverrides },
    });
    assert.equal(invalid.status, 400);
  }
  const created = await request("/api/posts", {
    cookie: admin.cookie,
    body: { ...body, textOverrides: { [id]: "Custom account text" } },
  });
  assert.equal(created.status, 201);
  const { post } = (await created.json()) as { post: Post };
  const updated = await request(`/api/posts/${post.id}`, {
    cookie: admin.cookie,
    method: "PATCH",
    body: {
      ...body,
      version: post.version,
      idempotencyKey: randomUUID(),
      textOverrides: { [id]: "Updated custom text" },
    },
  });
  assert.equal(updated.status, 200);
  const changed = (await updated.json()) as { post: Post };
  assert.equal(changed.post.deliveries[0].textOverride, "Updated custom text");
  const reset = await request(`/api/posts/${post.id}`, {
    cookie: admin.cookie,
    method: "PATCH",
    body: {
      ...body,
      text: "Updated master",
      version: changed.post.version,
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(reset.status, 200);
  assert.equal(
    ((await reset.json()) as { post: Post }).post.deliveries[0].textOverride,
    null,
  );
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
  assert.equal((await claimDelivery())?.text, "Updated master");
});
