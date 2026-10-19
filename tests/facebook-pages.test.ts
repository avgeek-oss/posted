import { after, afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createHmac, randomUUID } from "node:crypto";
import {
  sql,
  request,
  setupUser,
  resetDatabase,
  cleanupDatabase,
} from "./support.js";
import { app } from "../apps/api/src/app.js";
import { facebookPages } from "../apps/api/src/social/facebook-pages.js";
import {
  facebookJson,
  facebookScopes,
} from "../apps/api/src/social/facebook-api.js";
import { enabledProviders } from "../apps/api/src/social/capabilities.js";
import { config } from "../apps/api/src/config.js";
import { unseal } from "../apps/api/src/social/secrets.js";
import { preparePublication } from "../apps/api/src/social/publish.js";
import {
  claimDelivery,
  publishingBoundary,
  failDelivery,
} from "../apps/api/src/posts/queue.js";
import { deliverNext } from "../apps/worker/src/delivery.js";
import { ProviderFailure } from "../apps/api/src/social/network.js";

process.env.POSTED_FACEBOOK_CLIENT_ID = "facebook-test-client";
process.env.POSTED_FACEBOOK_CLIENT_SECRET = "facebook-test-secret";
beforeEach(resetDatabase);
afterEach(() => mock.restoreAll());
after(cleanupDatabase);
let revoked = false;
let publishStatus = 200;
let publishError: unknown;
let posts: unknown[] = [];
let subjectId = "1001";
function provider(onRequest?: (url: URL, init?: RequestInit) => Promise<void>) {
  revoked = false;
  subjectId = "1001";
  publishStatus = 200;
  publishError = undefined;
  posts = [];
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert(
        ["graph.facebook.com", "graph-video.facebook.com"].includes(
          url.hostname,
        ),
      );
      await onRequest?.(url, init);
      if (url.pathname === "/v26.0/oauth/access_token") {
        assert.equal(url.searchParams.get("client_id"), "facebook-test-client");
        assert.equal(
          url.searchParams.get("client_secret"),
          "facebook-test-secret",
        );
        return Response.json({
          access_token: url.searchParams.has("fb_exchange_token")
            ? "user-long-token"
            : "user-short-token",
          expires_in: 60 * 86400,
        });
      }
      const token = new Headers(init?.headers)
        .get("Authorization")
        ?.replace(/^Bearer /, "");
      const expected = createHmac("sha256", "facebook-test-secret")
        .update(token ?? "")
        .digest("hex");
      const body = init?.body;
      const proof =
        body instanceof FormData || body instanceof URLSearchParams
          ? body.get("appsecret_proof")
          : url.searchParams.get("appsecret_proof");
      assert.equal(proof, expected);
      if (url.pathname === "/v26.0/me") return Response.json({ id: subjectId });
      if (url.pathname === "/v26.0/me/permissions")
        return Response.json({
          data: facebookScopes.map((permission) => ({
            permission,
            status: "granted",
          })),
        });
      if (url.pathname === "/v26.0/me/accounts") {
        assert.equal(token, "user-long-token");
        assert.match(
          url.searchParams.get("fields")!,
          /picture.width\(200\).height\(200\)/,
        );
        return Response.json({
          data: revoked
            ? []
            : [
                {
                  id: "123",
                  name: "Page One",
                  username: "page-one",
                  access_token: "page-one-token",
                  tasks: ["CREATE_CONTENT"],
                  picture: {
                    data: { url: "https://example.test/large-avatar.jpg" },
                  },
                },
                {
                  id: "456",
                  name: "Page Two",
                  access_token: "page-two-token",
                  tasks: ["PROFILE_PLUS_FULL_CONTROL"],
                },
                {
                  id: "789",
                  name: "Analytics only",
                  access_token: "analytics-token",
                  tasks: ["ANALYZE"],
                },
              ],
        });
      }
      if (url.pathname === "/v26.0/123/photos") {
        assert.equal(token, "page-one-token");
        assert(body instanceof FormData);
        assert.equal(body.get("published"), "false");
        assert(body.get("source") instanceof Blob);
        return Response.json({ id: "555" });
      }
      if (url.pathname === "/v26.0/123/videos") {
        assert.equal(url.hostname, "graph-video.facebook.com");
        assert.equal(token, "page-one-token");
        assert(body instanceof FormData);
        assert(body.get("source") instanceof Blob);
        posts.push({ video: true, description: body.get("description") });
        return Response.json({ id: "999" });
      }
      if (url.pathname.endsWith("/feed")) {
        assert.equal(
          token,
          url.pathname.includes("/456/") ? "page-two-token" : "page-one-token",
        );
        assert(body instanceof URLSearchParams);
        posts.push(Object.fromEntries(body));
        return publishError
          ? Response.json(publishError, { status: publishStatus })
          : Response.json({ id: `123_${posts.length}` });
      }
      throw new Error(`Unexpected Facebook path ${url.pathname}`);
    },
  );
}
async function begin(cookie: string) {
  const r = await request("/api/social/connect/facebook-pages", {
    cookie,
    body: {},
  });
  assert.equal(r.status, 200);
  const url = new URL((await r.json()).authorizationUrl);
  assert.equal(url.origin, "https://www.facebook.com");
  assert.equal(url.pathname, "/v26.0/dialog/oauth");
  assert.equal(url.searchParams.get("client_id"), "facebook-test-client");
  assert.equal(url.searchParams.get("scope"), facebookScopes.join(","));
  assert.equal(url.searchParams.get("response_type"), "code");
  return `/api/social/callback/facebook-pages?state=${url.searchParams.get("state")}&code=fixture`;
}
async function grant(cookie: string) {
  const callback = await begin(cookie);
  const r = await request(callback, { cookie });
  assert.equal(r.status, 302);
  const id = new URL(r.headers.get("location")!).searchParams.get(
    "facebookPages",
  );
  assert(id);
  return { callback, path: `/api/social/facebook-pages/authorizations/${id}` };
}
async function connect(cookie: string, ids = ["123"]) {
  const g = await grant(cookie);
  assert.equal(
    (await request(g.path, { cookie, body: { accountIds: ids } })).status,
    200,
  );
  return (
    await sql<
      { id: string }[]
    >`SELECT id FROM social_connections WHERE account_id=${ids[0]!}`
  )[0]!.id;
}
async function scheduled(cookie: string, id: string, text = "Hello Facebook") {
  const r = await request("/api/posts", {
    cookie,
    body: {
      text,
      connectionIds: [id],
      mediaIds: [],
      scheduledAt: new Date().toISOString(),
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(r.status, 201);
  return (await r.json()).post;
}
function signed(
  secret = process.env.POSTED_FACEBOOK_CLIENT_SECRET!,
  id = "1001",
  issuedAt = Math.floor(Date.now() / 1000),
) {
  const payload = Buffer.from(
    JSON.stringify({
      algorithm: "HMAC-SHA256",
      user_id: id,
      issued_at: issuedAt,
    }),
  ).toString("base64url");
  return `${createHmac("sha256", secret).update(payload).digest("base64url")}.${payload}`;
}
function callback(action: "deauthorize" | "data-deletion", value = signed()) {
  return app.request(`/api/social/facebook/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ signed_request: value }),
  });
}

test("Facebook Pages requires complete operator configuration and does not expose a personal-profile provider", () => {
  assert(
    !enabledProviders({ POSTED_FACEBOOK_CLIENT_ID: "id" }).some(
      (p) => p.id === "facebook-pages",
    ),
  );
  assert.deepEqual(
    enabledProviders({
      POSTED_FACEBOOK_CLIENT_ID: "id",
      POSTED_FACEBOOK_CLIENT_SECRET: "secret",
    }).map((p) => p.id),
    ["facebook-pages"],
  );
  const secret = process.env.POSTED_FACEBOOK_CLIENT_SECRET;
  process.env.POSTED_FACEBOOK_CLIENT_SECRET = "";
  try {
    assert.throws(() => config());
  } finally {
    process.env.POSTED_FACEBOOK_CLIENT_SECRET = secret;
  }
});

test("OAuth selection is administrator-bound, private, explicit, one-use and reconnects each selected Page to its own token", async () => {
  const admin = await setupUser();
  provider();
  const callbackUrl = await begin(admin.cookie);
  const otherId = randomUUID();
  await sql`INSERT INTO users(id,workspace_id,name,email,password_hash,email_verified,role) SELECT ${otherId},workspace_id,'Other','other@example.test',password_hash,true,'admin' FROM users WHERE id=${admin.user.id}`;
  const login = await request("/api/auth/login", {
    body: {
      email: "other@example.test",
      password: "Secure test passphrase 42!",
    },
  });
  const otherCookie = login.headers.get("set-cookie")!.split(";")[0]!;
  assert.equal(
    (await request(callbackUrl, { cookie: otherCookie })).status,
    400,
  );
  const first = await grant(admin.cookie);
  assert.equal(
    (await request(first.path, { cookie: otherCookie })).status,
    404,
  );
  assert.equal(
    (await request(first.callback, { cookie: admin.cookie })).status,
    400,
  );
  const pages = await (
    await request(first.path, { cookie: admin.cookie })
  ).json();
  assert.deepEqual(
    pages.pages.map((p: { accountId: string }) => p.accountId),
    ["123", "456"],
  );
  assert(!JSON.stringify(pages).includes("token"));
  const [stored] =
    await sql`SELECT encrypted_grant FROM facebook_page_authorizations`;
  assert(!stored.encryptedGrant.includes("token"));
  assert.equal(
    (
      await request(first.path, {
        cookie: admin.cookie,
        body: { accountIds: ["789"] },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(first.path, {
        cookie: admin.cookie,
        body: { accountIds: ["123", "123"] },
      })
    ).status,
    400,
  );
  const results = await Promise.all(
    [1, 2].map(() =>
      request(first.path, {
        cookie: admin.cookie,
        body: { accountIds: ["123", "456"] },
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  const accounts =
    await sql`SELECT * FROM social_connections ORDER BY account_id`;
  assert.equal(accounts.length, 2);
  for (const [index, account] of accounts.entries()) {
    const credential = unseal(
      account.encryptedCredentials,
      `social-connection:${account.id}`,
    ) as { accessToken: string };
    assert.equal(
      credential.accessToken,
      index === 0 ? "page-one-token" : "page-two-token",
    );
    assert(account.facebookSubjectHash);
  }
  const previousId = accounts[0]!.id;
  assert.equal(await connect(admin.cookie), previousId);
});

test("Page selection revalidates access, rejects expired/cancelled grants and blocks a downgraded administrator", async () => {
  const admin = await setupUser();
  provider();
  const g = await grant(admin.cookie);
  revoked = true;
  assert.equal(
    (
      await request(g.path, {
        cookie: admin.cookie,
        body: { accountIds: ["123"] },
      })
    ).status,
    403,
  );
  revoked = false;
  assert.equal(
    (await request(g.path, { cookie: admin.cookie, method: "DELETE" })).status,
    200,
  );
  assert.equal((await request(g.path, { cookie: admin.cookie })).status, 404);
  const expired = await grant(admin.cookie);
  await sql`UPDATE facebook_page_authorizations SET expires_at=now()-interval '1 second'`;
  assert.equal(
    (
      await request(expired.path, {
        cookie: admin.cookie,
        body: { accountIds: ["123"] },
      })
    ).status,
    404,
  );
  const downgraded = await grant(admin.cookie);
  await sql`UPDATE users SET role='member' WHERE id=${admin.user.id}`;
  assert.equal(
    (await request(downgraded.path, { cookie: admin.cookie })).status,
    403,
  );
  assert.equal(
    (
      await request("/api/social/connect/facebook-pages", {
        cookie: admin.cookie,
        body: {},
      })
    ).status,
    403,
  );
  assert.equal((await sql`SELECT id FROM social_connections`).length, 0);
});

for (const phase of ["callback", "selection"] as const)
  test(`Facebook ${phase} network discovery does not lock the workspace and rechecks revoked authority`, async () => {
    const admin = await setupUser();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((r) => {
      enter = r;
    });
    const released = new Promise<void>((r) => {
      release = r;
    });
    let block = phase === "callback";
    provider(async (url) => {
      if (block && url.pathname.endsWith("/me/accounts")) {
        enter();
        await released;
      }
    });
    const path =
      phase === "callback"
        ? await begin(admin.cookie)
        : (await grant(admin.cookie)).path;
    block = true;
    const operation = request(path, {
      cookie: admin.cookie,
      ...(phase === "selection" ? { body: { accountIds: ["123"] } } : {}),
    });
    await entered;
    try {
      const read = await request("/api/connections", { cookie: admin.cookie });
      assert.equal(read.status, 200);
      await sql`UPDATE users SET role='member' WHERE id=${admin.user.id}`;
    } finally {
      release();
    }
    assert.equal((await operation).status, 403);
    assert.equal((await sql`SELECT id FROM social_connections`).length, 0);
  });

test("Page discovery follows bounded cursors on the fixed Meta host and checks all required permissions", async () => {
  const urls: string[] = [];
  let calls = 0;
  mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    urls.push(url.origin);
    if (url.pathname.endsWith("permissions"))
      return Response.json({
        data: facebookScopes.map((permission) => ({
          permission,
          status: "granted",
        })),
      });
    calls++;
    return Response.json({
      data: [],
      paging: {
        next: "https://attacker.invalid/?access_token=secret",
        cursors: { after: "same-cursor" },
      },
    });
  });
  await assert.rejects(() => facebookPages("fixture"), /invalid Page cursor/);
  assert.equal(calls, 2);
  assert(urls.every((url) => url === "https://graph.facebook.com"));
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () =>
    Response.json({
      data: [{ permission: "pages_show_list", status: "granted" }],
    }),
  );
  await assert.rejects(() => facebookPages("fixture"), /Allow Page listing/);
});

test("Facebook publishes text with a link using the Page token and never repeats a completed delivery", async () => {
  const admin = await setupUser();
  provider();
  const id = await connect(admin.cookie);
  const post = await scheduled(
    admin.cookie,
    id,
    "A link https://example.com/story",
  );
  assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), false);
  assert.equal(posts.length, 1);
  assert.equal(
    (posts[0] as { link: string }).link,
    "https://example.com/story",
  );
  const [delivery] =
    await sql`SELECT state,provider_post_id,published_url FROM post_deliveries WHERE group_id=${post.id}`;
  assert.equal(delivery.state, "published");
  assert.equal(delivery.providerPostId, "123_1");
  assert.equal(delivery.publishedUrl, "https://www.facebook.com/123_1");
});

test("Photo preparation stays unpublished until the durable boundary, and videos upload only when publishing", async () => {
  const admin = await setupUser();
  provider();
  const id = await connect(admin.cookie);
  await scheduled(admin.cookie, id);
  const job = await claimDelivery();
  assert(job);
  const prepared = await preparePublication(
    job,
    [
      {
        id: randomUUID(),
        bytes: Buffer.from("prepared-jpeg"),
        width: 100,
        height: 100,
        alt: "Landscape",
      },
    ],
    "page-one-token",
  );
  assert.equal(posts.length, 0);
  assert.deepEqual(prepared.checkpoint, { mediaIds: ["555"] });
  assert.equal(await publishingBoundary(job), true);
  await prepared.publish();
  assert.equal(posts.length, 1);
  assert.equal(
    (posts[0] as { attached_media: string }).attached_media,
    '[{"media_fbid":"555"}]',
  );
  const video = await preparePublication(
    job,
    [
      {
        id: randomUUID(),
        kind: "video",
        bytes: Buffer.from("prepared-video"),
        width: 1280,
        height: 720,
        durationSeconds: 4,
        alt: "Clip",
      },
    ],
    "page-one-token",
  );
  assert.equal(posts.length, 1);
  assert.equal((await video.publish()).id, "999");
  assert.equal(posts.length, 2);
});

test("Graph token revocation maps HTTP 400 to reauthentication, and transient errors preserve uncertainty", async () => {
  const admin = await setupUser();
  provider();
  const id = await connect(admin.cookie);
  await scheduled(admin.cookie, id);
  publishStatus = 400;
  publishError = { error: { code: 190 } };
  await deliverNext();
  assert.equal(
    (await sql`SELECT state FROM social_connections WHERE id=${id}`)[0]!.state,
    "reauthentication_required",
  );
  assert.equal(
    (await sql`SELECT state FROM post_deliveries`)[0]!.state,
    "failed",
  );
  await assert.rejects(
    () =>
      facebookJson("123/feed", "page-one-token", z.object({ id: z.string() }), {
        method: "POST",
        body: new URLSearchParams({ message: "test" }),
      }),
    (e) => e instanceof ProviderFailure && e.status === 401,
  );
  publishError = { error: { code: 2, is_transient: true } };
  await assert.rejects(
    () =>
      facebookJson("123/feed", "page-one-token", z.object({ id: z.string() }), {
        method: "POST",
        body: new URLSearchParams({ message: "test" }),
      }),
    (e) => e instanceof ProviderFailure && e.status === 503 && e.uncertain,
  );
});

test("Facebook callbacks reject forged signatures and revoke every Page from the matching grantor, keeping other accounts", async () => {
  const admin = await setupUser();
  provider();
  const id = await connect(admin.cookie, ["123", "456"]);
  await scheduled(admin.cookie, id);
  subjectId = "2002";
  const other = await connect(admin.cookie, ["456"]);
  subjectId = "1001";
  // Reconnecting a Page with a different grantor replaces only that Page's grant.
  const g = await grant(admin.cookie);
  assert.equal(
    (await callback("deauthorize", signed("wrong-secret"))).status,
    400,
  );
  assert.equal((await sql`SELECT * FROM facebook_account_events`).length, 0);
  const oldEvent = signed();
  assert.equal((await callback("deauthorize", oldEvent)).status, 200);
  assert.equal(
    (await sql`SELECT * FROM social_connections WHERE state='disconnected'`)
      .length,
    1,
  );
  assert.equal(
    (await sql`SELECT state FROM social_connections WHERE id=${other}`)[0]!
      .state,
    "connected",
  );
  assert.equal(
    (await sql`SELECT * FROM post_deliveries WHERE state='cancelled'`).length,
    1,
  );
  assert.equal((await request(g.path, { cookie: admin.cookie })).status, 404);
  assert.equal(
    (
      await sql`SELECT encrypted_credentials FROM social_connections WHERE id=${id}`
    )[0]!.encryptedCredentials,
    "",
  );
  await connect(admin.cookie);
  assert.equal((await callback("deauthorize", oldEvent)).status, 200);
  assert.equal(
    (await sql`SELECT state FROM social_connections WHERE id=${id}`)[0]!.state,
    "connected",
  );
});

test("Uninstall during OAuth or Page selection cannot restore revoked access", async () => {
  const admin = await setupUser();
  let revoke = false;
  let eventNumber = 0;
  provider(async (url) => {
    if (revoke && url.pathname.endsWith("/me/accounts"))
      await callback(
        "deauthorize",
        signed(
          undefined,
          "1001",
          Math.floor(Date.now() / 1000) + eventNumber++,
        ),
      );
  });
  const old = await begin(admin.cookie);
  revoke = true;
  assert.equal((await request(old, { cookie: admin.cookie })).status, 409);
  revoke = false;
  const g = await grant(admin.cookie);
  revoke = true;
  assert.equal(
    (
      await request(g.path, {
        cookie: admin.cookie,
        body: { accountIds: ["123"] },
      })
    ).status,
    409,
  );
  assert.equal((await sql`SELECT id FROM social_connections`).length, 0);
});

test("Deletion returns an idempotent anonymous receipt and removes Page data while preserving team drafts", async () => {
  const admin = await setupUser();
  provider();
  const id = await connect(admin.cookie);
  await scheduled(admin.cookie, id);
  const draft = randomUUID();
  await request(`/api/drafts/${draft}`, {
    cookie: admin.cookie,
    body: {
      text: "Team copy",
      connectionIds: [id],
      textOverrides: { [id]: "Page copy" },
      mediaIds: [],
      version: 0,
      idempotencyKey: randomUUID(),
    },
  });
  const payload = signed();
  const first = await callback("data-deletion", payload);
  assert.equal(first.status, 200);
  const receipt = await first.json();
  assert.deepEqual(
    await (await callback("data-deletion", payload)).json(),
    receipt,
  );
  assert.equal((await sql`SELECT id FROM social_connections`).length, 0);
  assert.equal((await sql`SELECT id FROM post_deliveries`).length, 0);
  const [saved] =
    await sql`SELECT text,connection_ids,text_overrides FROM post_drafts WHERE id=${draft}`;
  assert.equal(saved.text, "Team copy");
  assert.deepEqual(saved.connectionIds, []);
  assert.deepEqual(saved.textOverrides, {});
  const status = await app.request(new URL(receipt.url).pathname);
  assert.equal(status.status, 200);
  const body = await status.text();
  assert.match(body, /Facebook data deletion complete/);
  assert(!body.includes("page-one-token"));
});

test("A delayed rate limit response cannot retry a revoked Facebook delivery after reconnection", async () => {
  const admin = await setupUser();
  provider();
  const id = await connect(admin.cookie);
  await scheduled(admin.cookie, id);
  const job = await claimDelivery();
  assert(job);
  assert(await publishingBoundary(job));
  await callback("deauthorize");
  await connect(admin.cookie);
  await failDelivery(job, "Rate limited", false, { retryAfterMs: 1000 });
  const [delivery] =
    await sql`SELECT state,retry_cancelled_at FROM post_deliveries WHERE id=${job.id}`;
  assert.equal(delivery.state, "cancelled");
  assert(delivery.retryCancelledAt);
});

test("Facebook rate limits retry the same delivery, while ambiguous server failures block the remaining sequence", async () => {
  const admin = await setupUser();
  provider();
  const id = await connect(admin.cookie);
  const response = await request("/api/posts", {
    cookie: admin.cookie,
    body: {
      text: "First",
      additionalPosts: [{ text: "Second", mediaIds: [] }],
      connectionIds: [id],
      mediaIds: [],
      scheduledAt: new Date().toISOString(),
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(response.status, 201);
  const group = (await response.json()).post;
  publishStatus = 400;
  publishError = { error: { code: 4 } };
  await deliverNext();
  const [retry] =
    await sql`SELECT * FROM post_deliveries WHERE group_id=${group.id} ORDER BY post_index`;
  assert.equal(retry.state, "scheduled");
  assert.equal(retry.attempts, 1);
  assert(retry.availableAt > new Date());
  assert.equal(await deliverNext(), false);
  await sql`UPDATE post_deliveries SET available_at=now() WHERE id=${retry.id}`;
  publishError = undefined;
  await deliverNext();
  assert.equal(
    (await sql`SELECT state FROM post_deliveries WHERE id=${retry.id}`)[0]!
      .state,
    "published",
  );
  publishStatus = 503;
  publishError = { error: { code: 2, is_transient: true } };
  await deliverNext();
  const deliveries =
    await sql`SELECT state,attempts FROM post_deliveries WHERE group_id=${group.id} ORDER BY post_index`;
  assert.deepEqual(
    deliveries.map((d) => d.state),
    ["published", "uncertain"],
  );
  const calls = posts.length;
  assert.equal(await deliverNext(), false);
  assert.equal(posts.length, calls);
});
