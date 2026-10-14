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
} from "./support.js";
import { claimDelivery } from "../apps/api/src/posts/queue.js";
import type { PostDraft } from "../packages/contracts/src/index.js";

beforeEach(resetDatabase);
after(cleanupDatabase);
const input = (changes: Record<string, unknown> = {}) => ({
  text: "",
  textOverrides: {},
  connectionIds: [],
  mediaIds: [],
  version: 0,
  idempotencyKey: randomUUID(),
  ...changes,
});
async function account(state = "connected") {
  const [row] = await sql<
    { id: string }[]
  >`INSERT INTO social_connections(workspace_id,provider,account_id,name,handle,encrypted_credentials,state) VALUES((SELECT id FROM workspace),'bluesky',${randomUUID()},'Example','example.bsky.social','not-a-real-token',${state}) RETURNING id`;
  return row.id;
}
test("draft attribution follows accepted saves without transferring on retries or rejected edits", async () => {
  const admin = await setupUser();
  const memberId = randomUUID();
  await sql`INSERT INTO users(id,workspace_id,name,email,password_hash,email_verified,role)
    SELECT ${memberId},workspace_id,'Team editor','editor@example.test',password_hash,true,'member'
    FROM users WHERE id=${admin.user.id}`;
  const login = await request("/api/auth/login", {
    body: {
      email: "editor@example.test",
      password: "Secure test passphrase 42!",
    },
  });
  assert.equal(login.status, 200);
  const memberCookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(memberCookie);
  const id = randomUUID();
  const created = await request(`/api/drafts/${id}`, {
    cookie: admin.cookie,
    body: input(),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).draft.draftedBy.id, admin.user.id);
  const body = input({ text: "A team member's idea", version: 1 });
  const saved = await request(`/api/drafts/${id}`, {
    cookie: memberCookie,
    body,
  });
  assert.equal(saved.status, 200);
  const draft: PostDraft = (await saved.json()).draft;
  assert.deepEqual(draft.draftedBy, {
    id: memberId,
    name: "Team editor",
    avatarUrl: `https://www.gravatar.com/avatar/${createHash("sha256").update("editor@example.test").digest("hex")}?s=160&d=404&r=g`,
  });
  assert.equal(JSON.stringify(draft).includes("editor@example.test"), false);
  const replay = await request(`/api/drafts/${id}`, {
    cookie: admin.cookie,
    body,
  });
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).draft.draftedBy, draft.draftedBy);
  for (const [changes, status] of [
    [{ ...body, idempotencyKey: randomUUID() }, 409],
    [input({ version: 2, draftedBy: { id: admin.user.id } }), 400],
  ] as const)
    assert.equal(
      (
        await request(`/api/drafts/${id}`, {
          cookie: admin.cookie,
          body: changes,
        })
      ).status,
      status,
    );
  const list = await request("/api/drafts", { cookie: admin.cookie });
  assert.deepEqual((await list.json()).items[0].draftedBy, draft.draftedBy);
  assert.equal(
    (await sql`SELECT version FROM post_drafts WHERE id=${id}`)[0].version,
    2,
  );
});

test("draft attribution migration backfills only drafts with no prior edits", async () => {
  const admin = await setupUser();
  const untouched = randomUUID();
  const edited = randomUUID();
  for (const id of [untouched, edited])
    await request(`/api/drafts/${id}`, { cookie: admin.cookie, body: input() });
  await request(`/api/drafts/${edited}`, {
    cookie: admin.cookie,
    body: input({ version: 1, text: "Historical edit" }),
  });
  await sql`ALTER TABLE post_drafts DROP COLUMN last_edited_by`;
  await sql.unsafe(
    await readFile(
      new URL(
        "../packages/database/migrations/008_draft_editors.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const list = await request("/api/drafts", { cookie: admin.cookie });
  const drafts: PostDraft[] = (await list.json()).items;
  assert.equal(
    drafts.find((draft) => draft.id === untouched)?.draftedBy?.id,
    admin.user.id,
  );
  assert.equal(drafts.find((draft) => draft.id === edited)?.draftedBy, null);
});

test("drafts preserve empty and over-limit content, disconnected accounts and image order without queueing", async () => {
  const admin = await setupUser();
  const id = randomUUID();
  const empty = await request(`/api/drafts/${id}`, {
    cookie: admin.cookie,
    body: input(),
  });
  assert.equal(empty.status, 201);
  const connection = await account("disconnected");
  const images = [randomUUID(), randomUUID()];
  for (const image of images)
    await sql`INSERT INTO post_media(id,workspace_id,created_by,object_key,file_name,content_type,size_bytes,width,height,state) VALUES(${image},(SELECT id FROM workspace),${admin.user.id},${image},'review.png','image/png',100,100,100,'ready')`;
  const body = input({
    text: "x".repeat(4000),
    textOverrides: { [connection]: "y".repeat(1000) },
    connectionIds: [connection],
    mediaIds: images.reverse(),
    version: 1,
  });
  const saved = await request(`/api/drafts/${id}`, {
    cookie: admin.cookie,
    body,
  });
  assert.equal(saved.status, 200);
  const { draft }: { draft: PostDraft } = await saved.json();
  assert.equal(draft.version, 2);
  assert.equal(draft.text, body.text);
  assert.equal(draft.textOverrides[connection], "y".repeat(1000));
  assert.equal(draft.connections[0].state, "disconnected");
  assert.deepEqual(
    draft.media.map((image) => image.id),
    images,
  );
  const loaded = await request(`/api/drafts/${id}`, { cookie: admin.cookie });
  assert.deepEqual((await loaded.json()).draft, draft);
  assert.equal((await sql`SELECT id FROM post_groups`).length, 0);
  assert.equal((await sql`SELECT id FROM post_deliveries`).length, 0);
  assert.equal(await claimDelivery(), null);
  for (const view of ["scheduled", "history"])
    assert.equal(
      (
        await (
          await request(`/api/posts?view=${view}`, { cookie: admin.cookie })
        ).json()
      ).total,
      0,
    );
});
test("draft saves replay safely, reject changed request content and stale concurrent updates", async () => {
  const admin = await setupUser();
  const id = randomUUID();
  const body = input({ text: "An idea" });
  const responses = await Promise.all([
    request(`/api/drafts/${id}`, { cookie: admin.cookie, body }),
    request(`/api/drafts/${id}`, { cookie: admin.cookie, body }),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 201],
  );
  assert.equal((await sql`SELECT version FROM post_drafts`)[0].version, 1);
  assert.equal(
    (
      await request(`/api/drafts/${id}`, {
        cookie: admin.cookie,
        body: { ...body, text: "Changed" },
      })
    ).status,
    409,
  );
  const updates = await Promise.all([
    request(`/api/drafts/${id}`, {
      cookie: admin.cookie,
      body: input({ text: "First edit", version: 1 }),
    }),
    request(`/api/drafts/${id}`, {
      cookie: admin.cookie,
      body: input({ text: "Second edit", version: 1 }),
    }),
  ]);
  assert.deepEqual(
    updates.map((response) => response.status).sort(),
    [200, 409],
  );
  assert.equal((await sql`SELECT version FROM post_drafts`)[0].version, 2);
  assert.equal(
    (
      await request(`/api/drafts/${id}`, {
        cookie: admin.cookie,
        method: "DELETE",
        body: { version: 1 },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/api/drafts/${id}`, {
        cookie: admin.cookie,
        method: "DELETE",
        body: { version: 2 },
      })
    ).status,
    200,
  );
});
test("draft publication validates content and atomically leaves one delivery set across retries", async () => {
  const admin = await setupUser();
  const connection = await account();
  const id = randomUUID();
  await request(`/api/drafts/${id}`, {
    cookie: admin.cookie,
    body: input({ text: "x".repeat(301), connectionIds: [connection] }),
  });
  const publish = {
    text: "x".repeat(301),
    textOverrides: {},
    connectionIds: [connection],
    mediaIds: [],
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    idempotencyKey: randomUUID(),
    draftSource: { id, version: 1 },
  };
  assert.equal(
    (await request("/api/posts", { cookie: admin.cookie, body: publish }))
      .status,
    400,
  );
  assert.equal(
    (await sql`SELECT published_post_id FROM post_drafts`)[0].publishedPostId,
    null,
  );
  assert.equal((await sql`SELECT id FROM post_groups`).length, 0);
  const valid = {
    ...publish,
    text: "Ready to share",
    idempotencyKey: randomUUID(),
  };
  assert.equal(
    (
      await request("/api/posts", {
        cookie: admin.cookie,
        body: { ...valid, draftSource: { id, version: 2 } },
      })
    ).status,
    409,
  );
  const results = await Promise.all([
    request("/api/posts", { cookie: admin.cookie, body: valid }),
    request("/api/posts", { cookie: admin.cookie, body: valid }),
  ]);
  assert.deepEqual(
    results.map((response) => response.status).sort(),
    [200, 201],
  );
  assert.equal((await sql`SELECT id FROM post_groups`).length, 1);
  assert.equal((await sql`SELECT id FROM post_deliveries`).length, 1);
  assert.equal(
    (await (await request("/api/drafts", { cookie: admin.cookie })).json())
      .total,
    0,
  );
  assert.equal(
    (
      await request("/api/posts", {
        cookie: admin.cookie,
        body: { ...valid, idempotencyKey: randomUUID() },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/api/drafts/${id}`, {
        cookie: admin.cookie,
        body: input({ version: 1, text: "Overwrite" }),
      })
    ).status,
    409,
  );
  assert.equal((await sql`SELECT id FROM post_groups`).length, 1);
});
test("drafts enforce authentication, write role, account/image ownership and clamped pagination", async () => {
  const admin = await setupUser();
  const id = randomUUID();
  assert.equal(
    (await request(`/api/drafts/${id}`, { body: input() })).status,
    401,
  );
  assert.equal(
    (
      await request(`/api/drafts/${id}`, {
        cookie: admin.cookie,
        body: input({ connectionIds: [randomUUID()] }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/api/drafts/${id}`, {
        cookie: admin.cookie,
        body: input({ mediaIds: [randomUUID()] }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/api/drafts/${id}`, {
        cookie: admin.cookie,
        body: input({ textOverrides: { [randomUUID()]: "unselected" } }),
      })
    ).status,
    400,
  );
  await sql`UPDATE users SET role='viewer' WHERE id=${admin.user.id}`;
  assert.equal(
    (
      await request(`/api/drafts/${id}`, {
        cookie: admin.cookie,
        body: input(),
      })
    ).status,
    403,
  );
  await sql`UPDATE users SET role='member' WHERE id=${admin.user.id}`;
  for (let i = 0; i < 3; i++)
    assert.equal(
      (
        await request(`/api/drafts/${randomUUID()}`, {
          cookie: admin.cookie,
          body: input({ text: `Draft ${i}` }),
        })
      ).status,
      201,
    );
  const page = await (
    await request("/api/drafts?page=99&pageSize=2", { cookie: admin.cookie })
  ).json();
  assert.equal(page.page, 2);
  assert.equal(page.total, 3);
  assert.equal(page.items.length, 1);
});
