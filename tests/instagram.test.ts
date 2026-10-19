import { after, afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import {
  sql,
  request,
  setupUser,
  resetDatabase,
  cleanupDatabase,
} from "./support.js";
import { app } from "../apps/api/src/app.js";
import { config } from "../apps/api/src/config.js";
import { enabledProviders } from "../apps/api/src/social/capabilities.js";
import { z } from "zod";
import {
  instagramSingle,
  instagramScopes,
} from "../apps/api/src/social/instagram.js";
import { refreshCredentials } from "../apps/api/src/social/tokens.js";
import { unseal } from "../apps/api/src/social/secrets.js";
import {
  preparePublication,
  type DeliveryMedia,
} from "../apps/api/src/social/publish.js";
import { waitForInstagramContainer } from "../apps/api/src/social/instagram-publish.js";
import {
  claimDelivery,
  publishingBoundary,
  completeDelivery,
  failDelivery,
} from "../apps/api/src/posts/queue.js";
import { ProviderFailure } from "../apps/api/src/social/network.js";
process.env.POSTED_INSTAGRAM_CLIENT_ID = "instagram-disposable-client";
process.env.POSTED_INSTAGRAM_CLIENT_SECRET = "instagram-disposable-secret";
beforeEach(resetDatabase);
afterEach(() => mock.restoreAll());
after(cleanupDatabase);
let accountType = "BUSINESS",
  grantScopes = instagramScopes.join(","),
  wrapped = true,
  publishStatus = 200,
  quota = 0,
  status = "FINISHED",
  permalink = true;
let creations: Record<string, string>[] = [],
  publications = 0,
  refreshes = 0;
function provider(hook?: (url: URL) => Promise<void>) {
  accountType = "BUSINESS";
  grantScopes = instagramScopes.join(",");
  wrapped = true;
  publishStatus = 200;
  quota = 0;
  status = "FINISHED";
  permalink = true;
  creations = [];
  publications = 0;
  refreshes = 0;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert(
        ["api.instagram.com", "graph.instagram.com"].includes(url.hostname),
      );
      await hook?.(url);
      if (url.hostname === "api.instagram.com") {
        assert.equal(url.pathname, "/oauth/access_token");
        assert(init?.body instanceof URLSearchParams);
        assert.equal(
          init.body.get("client_secret"),
          "instagram-disposable-secret",
        );
        const grant = {
          access_token: "short-instagram-token",
          user_id: "1001",
          permissions: grantScopes,
        };
        return Response.json(wrapped ? { data: [grant] } : grant);
      }
      if (url.pathname === "/access_token") {
        assert.equal(url.searchParams.get("grant_type"), "ig_exchange_token");
        return Response.json({
          access_token: "instagram-long-token",
          expires_in: 5184000,
        });
      }
      if (url.pathname === "/refresh_access_token") {
        assert.equal(url.searchParams.get("grant_type"), "ig_refresh_token");
        assert.equal(url.searchParams.has("client_secret"), false);
        refreshes++;
        return Response.json({
          access_token: "renewed-instagram-token",
          expires_in: 5184000,
        });
      }
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer instagram-long-token",
      );
      assert.equal(url.searchParams.has("access_token"), false);
      if (url.pathname.endsWith("/me")) {
        const profile = {
          id: "1001",
          user_id: "2001",
          username: "studio",
          name: "Studio",
          account_type: accountType,
          profile_picture_url: "https://example.test/avatar.jpg",
        };
        return Response.json(wrapped ? { data: [profile] } : profile);
      }
      if (url.pathname.endsWith("/content_publishing_limit"))
        return Response.json({
          data: [
            {
              quota_usage: quota,
              config: { quota_total: 100, quota_duration: 86400 },
            },
          ],
        });
      if (url.pathname.endsWith("/media")) {
        assert(init?.body instanceof URLSearchParams);
        creations.push(Object.fromEntries(init.body));
        return Response.json({ id: String(3000 + creations.length) });
      }
      if (url.pathname.endsWith("/media_publish")) {
        publications++;
        assert(init?.body instanceof URLSearchParams);
        assert(init.body.get("creation_id"));
        return publishStatus === 200
          ? Response.json({ id: "9001" })
          : Response.json(
              {
                error: {
                  code: publishStatus === 429 ? 4 : 2,
                  is_transient: publishStatus >= 500,
                },
              },
              { status: publishStatus },
            );
      }
      if (url.searchParams.get("fields") === "status_code")
        return Response.json({ status_code: status });
      if (url.searchParams.get("fields") === "permalink")
        return permalink
          ? Response.json({
              permalink: "https://www.instagram.com/p/confirmed/",
            })
          : new Response("unavailable", { status: 503 });
      throw new Error(`Unexpected Instagram path ${url.pathname}`);
    },
  );
}
async function begin(cookie: string) {
  const start = await request("/api/social/connect/instagram", {
    cookie,
    body: {},
  });
  assert.equal(start.status, 200);
  const url = new URL((await start.json()).authorizationUrl);
  assert.equal(url.origin, "https://www.instagram.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("scope"), instagramScopes.join(","));
  assert.equal(url.searchParams.get("force_reauth"), "true");
  return `/api/social/callback/instagram?state=${url.searchParams.get("state")}&code=fixture`;
}
async function connect(cookie: string) {
  const path = await begin(cookie);
  assert.equal((await request(path, { cookie })).status, 302);
  return (
    await sql`SELECT id FROM social_connections WHERE provider='instagram'`
  )[0]!.id as string;
}
async function scheduled(cookie: string, id: string) {
  const mediaId = randomUUID();
  await sql`INSERT INTO post_media(id,workspace_id,object_key,file_name,content_type,size_bytes,width,height,state) VALUES(${mediaId},(SELECT id FROM workspace),${`test/${mediaId}`},'photo.jpg','image/jpeg',10,400,500,'ready')`;
  const response = await request("/api/posts", {
    cookie,
    body: {
      text: "A caption",
      connectionIds: [id],
      mediaIds: [mediaId],
      additionalPosts: [{ text: "Next caption", mediaIds: [mediaId] }],
      scheduledAt: new Date().toISOString(),
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(response.status, 201);
  return (await response.json()).post;
}
const photo: DeliveryMedia = {
  id: randomUUID(),
  bytes: Buffer.from("prepared-jpeg"),
  width: 400,
  height: 500,
  alt: "A landscape",
  url: "https://media.example.test/delivery/photo.jpg?signature=fixture",
};
function signed(
  userId = "1001",
  secret = process.env.POSTED_INSTAGRAM_CLIENT_SECRET!,
) {
  const payload = Buffer.from(
    JSON.stringify({
      algorithm: "HMAC-SHA256",
      user_id: userId,
      issued_at: Math.floor(Date.now() / 1000),
    }),
  ).toString("base64url");
  return `${createHmac("sha256", secret).update(payload).digest("base64url")}.${payload}`;
}
function callback(action: string, value = signed()) {
  return app.request(`/api/social/instagram/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ signed_request: value }),
  });
}
test("Instagram is enabled only by complete configuration", () => {
  assert.deepEqual(enabledProviders({ POSTED_INSTAGRAM_CLIENT_ID: "id" }), []);
  assert.deepEqual(
    enabledProviders({
      POSTED_INSTAGRAM_CLIENT_ID: "id",
      POSTED_INSTAGRAM_CLIENT_SECRET: "secret",
    }).map((p) => p.id),
    ["instagram"],
  );
  const secret = process.env.POSTED_INSTAGRAM_CLIENT_SECRET;
  process.env.POSTED_INSTAGRAM_CLIENT_SECRET = "";
  try {
    assert.throws(() => config());
  } finally {
    process.env.POSTED_INSTAGRAM_CLIENT_SECRET = secret;
  }
});
for (const envelope of [true, false])
  test(`Instagram OAuth validates state, encrypts the grant, distinguishes account and callback IDs, and reconnects (${envelope ? "envelope" : "object"})`, async () => {
    const admin = await setupUser();
    provider();
    wrapped = envelope;
    const path = await begin(admin.cookie);
    assert.equal((await request(path, { cookie: admin.cookie })).status, 302);
    assert.equal((await request(path, { cookie: admin.cookie })).status, 400);
    const [row] = await sql`SELECT * FROM social_connections`;
    assert.equal(row.accountId, "2001");
    assert(row.instagramSubjectHash);
    assert(!row.encryptedCredentials.includes("instagram-long-token"));
    assert.equal(
      (
        unseal(row.encryptedCredentials, `social-connection:${row.id}`) as {
          accessToken: string;
        }
      ).accessToken,
      "instagram-long-token",
    );
    accountType = "MEDIA_CREATOR";
    assert.equal(await connect(admin.cookie), row.id);
    const publicList = JSON.stringify(
      await (
        await request("/api/connections", { cookie: admin.cookie })
      ).json(),
    );
    assert(!publicList.includes("instagramSubjectHash"));
    assert(!publicList.includes("instagram-long-token"));
  });
test("Instagram rejects personal profiles, missing publish permission and ambiguous response envelopes", async () => {
  const admin = await setupUser();
  provider();
  accountType = "PERSONAL";
  assert.equal(
    (await request(await begin(admin.cookie), { cookie: admin.cookie })).status,
    400,
  );
  accountType = "BUSINESS";
  grantScopes = "instagram_business_basic";
  assert.notEqual(
    (await request(await begin(admin.cookie), { cookie: admin.cookie })).status,
    302,
  );
  assert.equal((await sql`SELECT id FROM social_connections`).length, 0);
  const shape = instagramSingle(z.object({ access_token: z.string() }));
  assert(
    !shape.safeParse({
      data: [{ access_token: "one" }, { access_token: "two" }],
    }).success,
  );
  assert(
    !shape.safeParse({ access_token: "one", data: [{ access_token: "two" }] })
      .success,
  );
});
test("an Instagram callback cannot save a connection after authority is revoked during network discovery", async () => {
  const admin = await setupUser();
  let entered!: () => void, release!: () => void;
  const pending = new Promise<void>((r) => (entered = r)),
    unblock = new Promise<void>((r) => (release = r));
  provider(async (url) => {
    if (url.pathname.endsWith("/me")) {
      entered();
      await unblock;
    }
  });
  const operation = request(await begin(admin.cookie), {
    cookie: admin.cookie,
  });
  await pending;
  try {
    assert.equal(
      (await request("/api/connections", { cookie: admin.cookie })).status,
      200,
    );
    await sql`UPDATE users SET role='member' WHERE id=${admin.user.id}`;
  } finally {
    release();
  }
  assert.equal((await operation).status, 403);
  assert.equal((await sql`SELECT id FROM social_connections`).length, 0);
});
test("Instagram refreshes eligible long-lived grants without sending a client secret to refresh", async () => {
  provider();
  const token = {
    accessToken: "instagram-long-token",
    issuedAt: Date.now() - 2 * 86400000,
    expiresAt: Date.now() + 1000,
  };
  assert.equal(
    (await refreshCredentials("instagram", token)).accessToken,
    "renewed-instagram-token",
  );
  assert.equal(refreshes, 1);
  await assert.rejects(
    () => refreshCredentials("instagram", { ...token, issuedAt: Date.now() }),
    (e) => e instanceof ProviderFailure && e.status === 401,
  );
  assert.equal(refreshes, 1);
});
test("Instagram schedules require media and enforce captions, hashtags and per-account overrides", async () => {
  const admin = await setupUser();
  provider();
  const id = await connect(admin.cookie);
  assert.equal(
    (
      await request("/api/posts", {
        cookie: admin.cookie,
        body: {
          text: "Text only",
          connectionIds: [id],
          mediaIds: [],
          scheduledAt: new Date().toISOString(),
          idempotencyKey: randomUUID(),
        },
      })
    ).status,
    400,
  );
  await scheduled(admin.cookie, id);
  const [media] = await sql`SELECT id FROM post_media`;
  for (const text of [
    "x".repeat(2201),
    Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" "),
    Array.from({ length: 21 }, (_, i) => `@user${i}`).join(" "),
  ])
    assert.equal(
      (
        await request("/api/posts", {
          cookie: admin.cookie,
          body: {
            text: "Master",
            textOverrides: { [id]: text },
            connectionIds: [id],
            mediaIds: [media.id],
            scheduledAt: new Date().toISOString(),
            idempotencyKey: randomUUID(),
          },
        })
      ).status,
      400,
    );
});
test("Instagram prepares ordered photo containers before the durable publishing boundary", async () => {
  const admin = await setupUser();
  provider();
  const id = await connect(admin.cookie);
  await scheduled(admin.cookie, id);
  const job = await claimDelivery();
  assert(job);
  const prepared = await preparePublication(
    job,
    [
      photo,
      {
        ...photo,
        id: randomUUID(),
        url: "https://media.example.test/delivery/second.jpg",
      },
    ],
    "instagram-long-token",
  );
  assert.equal(publications, 0);
  assert.deepEqual(
    creations.map((v) => v.image_url),
    [photo.url, "https://media.example.test/delivery/second.jpg", undefined],
  );
  assert.equal(creations[2]!.children, "3001,3002");
  assert.equal(creations[2]!.caption, "A caption");
  assert.equal(creations[0]!.alt_text, photo.alt);
  assert(!("caption" in creations[0]!));
  assert.equal(await publishingBoundary(job), true);
  await completeDelivery(job, await prepared.publish());
  assert.equal(publications, 1);
  const next = await claimDelivery();
  assert(next);
  assert.equal(next.replyTo, undefined);
});
test("Instagram Reels use a video container, and a failed permalink lookup preserves confirmed success", async () => {
  const admin = await setupUser();
  provider();
  const id = await connect(admin.cookie);
  await scheduled(admin.cookie, id);
  const job = await claimDelivery();
  assert(job);
  const prepared = await preparePublication(
    job,
    [{ ...photo, kind: "video", durationSeconds: 4 }],
    "instagram-long-token",
  );
  assert.equal(creations[0]!.media_type, "REELS");
  assert.equal(creations[0]!.video_url, photo.url);
  permalink = false;
  assert.deepEqual(await prepared.publish(), { id: "9001", url: "" });
  assert.equal(publications, 1);
});
test("Instagram quota stops preparation; an ambiguous publish blocks later posts and cannot be resumed", async () => {
  const admin = await setupUser();
  provider();
  const id = await connect(admin.cookie);
  const post = await scheduled(admin.cookie, id);
  const job = await claimDelivery();
  assert(job);
  quota = 100;
  await assert.rejects(
    () => preparePublication(job, [photo], "instagram-long-token"),
    (e) => e instanceof ProviderFailure && e.status === 429 && !e.uncertain,
  );
  assert.equal(creations.length, 0);
  quota = 0;
  const prepared = await preparePublication(
    job,
    [photo],
    "instagram-long-token",
  );
  assert.equal(await publishingBoundary(job), true);
  publishStatus = 503;
  await assert.rejects(
    () => prepared.publish(),
    (e) => e instanceof ProviderFailure && e.uncertain,
  );
  await failDelivery(job, "The publishing result is uncertain", true);
  assert.equal(await claimDelivery(), null);
  assert.deepEqual(
    (await sql`SELECT state FROM post_deliveries ORDER BY post_index`).map(
      (r) => r.state,
    ),
    ["uncertain", "failed"],
  );
  assert.equal(
    (
      await request(`/api/posts/${post.id}/resume`, {
        cookie: admin.cookie,
        body: { connectionId: id, version: 1, idempotencyKey: randomUUID() },
      })
    ).status,
    409,
  );
  assert.equal(publications, 1);
});
test("Instagram container status polling is bounded and never publishes an unfinished container", async () => {
  provider();
  status = "IN_PROGRESS";
  let waits = 0;
  await assert.rejects(
    () =>
      waitForInstagramContainer("3001", "instagram-long-token", async () => {
        waits++;
      }),
    /timed out/,
  );
  assert.equal(waits, 5);
  assert.equal(publications, 0);
  status = "PUBLISHED";
  await assert.rejects(
    () => waitForInstagramContainer("3001", "instagram-long-token"),
    /could not prepare/,
  );
});
test("Instagram uninstall and deletion use the app-scoped callback ID, preserve team copy and cannot revive an in-flight OAuth", async () => {
  const admin = await setupUser();
  provider();
  const id = await connect(admin.cookie);
  await scheduled(admin.cookie, id);
  const pending = await begin(admin.cookie);
  assert.equal(
    (await callback("deauthorize", signed("1001", "wrong"))).status,
    400,
  );
  await callback("deauthorize", signed("2001"));
  assert.equal(
    (await sql`SELECT state FROM social_connections WHERE id=${id}`)[0]!.state,
    "connected",
  );
  await callback("deauthorize");
  assert.equal(
    (
      await sql`SELECT state,encrypted_credentials FROM social_connections WHERE id=${id}`
    )[0]!.encryptedCredentials,
    "",
  );
  assert.equal((await request(pending, { cookie: admin.cookie })).status, 409);
  const deletionEvent = signed();
  const deletion = await callback("data-deletion", deletionEvent);
  const receipt = await deletion.json();
  assert.equal(deletion.status, 200);
  assert.equal((await sql`SELECT id FROM social_connections`).length, 0);
  assert.equal((await sql`SELECT text FROM post_groups`)[0]!.text, "A caption");
  assert.deepEqual(
    await (await callback("data-deletion", deletionEvent)).json(),
    receipt,
  );
  const publicReceipt = await (
    await app.request(new URL(receipt.url).pathname)
  ).text();
  assert(!publicReceipt.includes("Studio"));
  assert.match(publicReceipt, /Instagram data deletion complete/);
});
