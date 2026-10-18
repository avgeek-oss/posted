import { after, afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import {
  sql,
  request,
  setupUser,
  resetDatabase,
  cleanupDatabase,
} from "./support.js";
import { seal, unseal } from "../apps/api/src/social/secrets.js";
import { deliverNext } from "../apps/worker/src/delivery.js";
import {
  type DeliveryVideo,
  preparePublication,
} from "../apps/api/src/social/publish.js";
import {
  credentialsSchema,
  refreshCredentials,
} from "../apps/api/src/social/tokens.js";
import { ProviderFailure } from "../apps/api/src/social/network.js";
import type { DeliveryJob } from "../apps/api/src/posts/queue.js";
import { blueskyClient } from "../apps/api/src/social/bluesky.js";
import {
  OAuthResolverError,
  OAuthResponseError,
} from "@atproto/oauth-client-node";

beforeEach(resetDatabase);
afterEach(() => mock.restoreAll());
after(cleanupDatabase);
process.env.POSTED_X_CLIENT_ID = "disposable-client";
process.env.POSTED_X_CLIENT_SECRET = "disposable-secret";
process.env.POSTED_LINKEDIN_CLIENT_ID = "disposable-linkedin-client";
process.env.POSTED_LINKEDIN_CLIENT_SECRET = "disposable-linkedin-secret";
process.env.POSTED_THREADS_CLIENT_ID = "disposable-threads-client";
process.env.POSTED_THREADS_CLIENT_SECRET = "disposable-threads-secret";
function urlOf(input: string | URL | Request) {
  return new URL(input instanceof Request ? input.url : String(input));
}
function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(value, { status, headers });
}
async function duePost() {
  const admin = await setupUser();
  const id = randomUUID();
  const token = seal(
    {
      accessToken: "disposable-access",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3_600_000,
    },
    `social-connection:${id}`,
  );
  await sql`INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,encrypted_credentials) VALUES(${id},(SELECT id FROM workspace),'x','test-user','Account','example',${token})`;
  const response = await request("/api/posts", {
    cookie: admin.cookie,
    body: {
      text: "Safe local delivery verification",
      connectionIds: [id],
      mediaIds: [],
      scheduledAt: new Date().toISOString(),
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(response.status, 201);
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
  return admin;
}

test("X OAuth binds PKCE and state to the initiating team member, stores encrypted tokens and supports multiple accounts", async () => {
  const admin = await setupUser();
  let exchanges = 0;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.href === "https://api.x.com/2/oauth2/token") {
        exchanges++;
        assert.equal(init?.method, "POST");
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          `Basic ${Buffer.from("disposable-client:disposable-secret").toString("base64")}`,
        );
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("grant_type"), "authorization_code");
        assert.ok(body.get("code_verifier"));
        return json({
          access_token: "oauth-test-access",
          refresh_token: "oauth-test-refresh",
          expires_in: 7200,
        });
      }
      if (url.pathname === "/2/users/me")
        return json({
          data: {
            id: `user-${exchanges}`,
            name: "Example",
            username: `example${exchanges}`,
          },
        });
      throw new Error(
        `Unexpected provider request: ${url.origin}${url.pathname}`,
      );
    },
  );
  for (let index = 0; index < 2; index++) {
    const start = await request("/api/social/connect/x", {
      cookie: admin.cookie,
      body: {},
    });
    assert.equal(start.status, 200);
    const { authorizationUrl } = await start.json();
    const url = new URL(authorizationUrl);
    const state = url.searchParams.get("state");
    assert.ok(state);
    assert.equal(url.origin, "https://x.com");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const [pending] = await sql<
      { encryptedVerifier: string }[]
    >`SELECT encrypted_verifier FROM social_oauth_requests WHERE state_hash=${createHash("sha256").update(state).digest("hex")}`;
    const verifier = unseal(
      pending.encryptedVerifier,
      `social-oauth:${createHash("sha256").update(state).digest("hex")}`,
    );
    assert.equal(typeof verifier, "string");
    assert.equal(
      url.searchParams.get("code_challenge"),
      createHash("sha256").update(String(verifier)).digest("base64url"),
    );
    const callback = `/api/social/callback/x?state=${state}&code=fixture-code`;
    assert.equal(
      (await request(callback, { cookie: admin.cookie })).status,
      302,
    );
    assert.equal(
      (await request(callback, { cookie: admin.cookie })).status,
      400,
    );
  }
  const rows = await sql<
    { id: string; encryptedCredentials: string }[]
  >`SELECT id,encrypted_credentials FROM social_connections`;
  assert.equal(rows.length, 2);
  assert.equal(exchanges, 2);
  for (const row of rows) {
    assert.ok(!row.encryptedCredentials.includes("oauth-test-access"));
    assert.equal(
      credentialsSchema.parse(
        unseal(row.encryptedCredentials, `social-connection:${row.id}`),
      ).accessToken,
      "oauth-test-access",
    );
  }
  const wrong = await request(
    `/api/social/callback/x?state=${"A".repeat(43)}&code=fixture-code`,
    { cookie: admin.cookie },
  );
  assert.equal(wrong.status, 400);
  assert.equal(exchanges, 2);
});

test("expired X access tokens rotate with a refresh token; missing refresh permission requires reconnect", async () => {
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(urlOf(input).href, "https://api.x.com/2/oauth2/token");
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("grant_type"), "refresh_token");
      assert.equal(form.get("refresh_token"), "old-refresh");
      return json({ access_token: "rotated-access", expires_in: 7200 });
    },
  );
  const result = await refreshCredentials("x", {
    accessToken: "expired",
    refreshToken: "old-refresh",
    expiresAt: Date.now() - 1,
    issuedAt: Date.now() - 100_000,
  });
  assert.equal(result.accessToken, "rotated-access");
  assert.equal(result.refreshToken, "old-refresh");
  await assert.rejects(
    refreshCredentials("x", {
      accessToken: "expired",
      expiresAt: 1,
      issuedAt: 1,
    }),
    (error) => error instanceof ProviderFailure && error.status === 401,
  );
});

for (const provider of ["linkedin", "threads"] as const) {
  test(`${provider} OAuth preserves team ownership, uses its official exchange and rejects reused callback state`, async () => {
    const admin = await setupUser();
    let exchanges = 0;
    let extensions = 0;
    mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = urlOf(input);
        if (
          url.pathname === "/oauth/v2/accessToken" ||
          url.pathname === "/oauth/access_token"
        ) {
          exchanges++;
          assert.equal(init?.method, "POST");
          const form = new URLSearchParams(String(init?.body));
          assert.equal(form.get("client_id"), `disposable-${provider}-client`);
          assert.equal(
            form.get("client_secret"),
            `disposable-${provider}-secret`,
          );
          assert.equal(
            form.get("redirect_uri"),
            `${process.env.POSTED_API_URL}/api/social/callback/${provider}`,
          );
          return json({
            access_token: `${provider}-short-${exchanges}`,
            expires_in: 3600,
          });
        }
        if (url.href.startsWith("https://graph.threads.net/access_token?")) {
          extensions++;
          assert.equal(url.searchParams.get("grant_type"), "th_exchange_token");
          assert.equal(
            url.searchParams.get("client_secret"),
            "disposable-threads-secret",
          );
          assert.equal(
            url.searchParams.get("access_token"),
            `threads-short-${exchanges}`,
          );
          return json({
            access_token: `threads-long-${exchanges}`,
            expires_in: 5_184_000,
          });
        }
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          `Bearer ${provider}-${provider === "threads" ? "long" : "short"}-${exchanges}`,
        );
        if (url.href === "https://api.linkedin.com/v2/userinfo")
          return json({ sub: `linkedin-${exchanges}`, name: "Team account" });
        if (
          url.origin === "https://graph.threads.net" &&
          url.pathname === "/v1.0/me"
        )
          return json({ id: `threads-${exchanges}`, username: "teamaccount" });
        throw new Error("Unexpected OAuth provider request");
      },
    );
    for (let index = 0; index < 2; index++) {
      const start = await request(`/api/social/connect/${provider}`, {
        cookie: admin.cookie,
        body: {},
      });
      assert.equal(start.status, 200);
      const authorization = new URL((await start.json()).authorizationUrl);
      assert.equal(
        authorization.origin,
        provider === "linkedin"
          ? "https://www.linkedin.com"
          : "https://www.threads.net",
      );
      assert.equal(
        authorization.searchParams.get("scope"),
        provider === "linkedin"
          ? "openid profile w_member_social"
          : "threads_basic,threads_content_publish",
      );
      const state = authorization.searchParams.get("state");
      assert.ok(state);
      const callback = `/api/social/callback/${provider}?code=disposable-code&state=${state}`;
      assert.equal(
        (await request(callback, { cookie: admin.cookie })).status,
        302,
      );
      assert.equal(
        (await request(callback, { cookie: admin.cookie })).status,
        400,
      );
    }
    assert.equal(exchanges, 2);
    assert.equal(extensions, provider === "threads" ? 2 : 0);
    const rows = await sql<
      { id: string; workspaceId: string; encryptedCredentials: string }[]
    >`SELECT id,workspace_id,encrypted_credentials FROM social_connections WHERE provider=${provider}`;
    const [workspace] = await sql`SELECT id FROM workspace`;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.workspaceId, workspace.id);
      assert.ok(!row.encryptedCredentials.includes(`${provider}-`));
      assert.ok(
        credentialsSchema.parse(
          unseal(row.encryptedCredentials, `social-connection:${row.id}`),
        ).expiresAt,
      );
    }
  });
}

test("LinkedIn refresh retains its refresh token and Threads refresh requires an eligible long-lived token", async () => {
  let calls = 0;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      calls++;
      const url = urlOf(input);
      if (url.href === "https://www.linkedin.com/oauth/v2/accessToken") {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("grant_type"), "refresh_token");
        assert.equal(body.get("refresh_token"), "linkedin-refresh");
        assert.equal(body.get("client_secret"), "disposable-linkedin-secret");
        return json({ access_token: "linkedin-rotated", expires_in: 3_600 });
      }
      assert.equal(
        url.origin + url.pathname,
        "https://graph.threads.net/refresh_access_token",
      );
      assert.equal(url.searchParams.get("grant_type"), "th_refresh_token");
      assert.equal(url.searchParams.get("access_token"), "threads-long");
      return json({ access_token: "threads-rotated", expires_in: 5_184_000 });
    },
  );
  const old = {
    accessToken: "linkedin-old",
    refreshToken: "linkedin-refresh",
    expiresAt: Date.now() - 1,
    issuedAt: Date.now() - 200_000,
  };
  const linkedin = await refreshCredentials("linkedin", old);
  assert.equal(linkedin.accessToken, "linkedin-rotated");
  assert.equal(linkedin.refreshToken, "linkedin-refresh");
  const threads = await refreshCredentials("threads", {
    accessToken: "threads-long",
    expiresAt: Date.now() + 60_000,
    issuedAt: Date.now() - 48 * 3_600_000,
  });
  assert.equal(threads.accessToken, "threads-rotated");
  await assert.rejects(
    refreshCredentials("threads", {
      accessToken: "too-recent",
      expiresAt: Date.now() + 60_000,
      issuedAt: Date.now(),
    }),
    (error) => error instanceof ProviderFailure && error.status === 401,
  );
  await assert.rejects(
    refreshCredentials("linkedin", { ...old, refreshToken: undefined }),
    (error) => error instanceof ProviderFailure && error.status === 401,
  );
  assert.equal(calls, 2);
});

test("durable worker publishes once and persists the provider result in post history", async () => {
  const admin = await duePost();
  let publishes = 0;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(urlOf(input).href, "https://api.x.com/2/tweets");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer disposable-access",
      );
      publishes++;
      return json({ data: { id: "published-42" } }, 201);
    },
  );
  assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), false);
  assert.equal(publishes, 1);
  const history = await request("/api/posts?view=history", {
    cookie: admin.cookie,
  });
  const { items } = await history.json();
  assert.equal(items[0].state, "published");
  assert.equal(
    items[0].deliveries[0].publishedUrl,
    "https://x.com/i/status/published-42",
  );
});

test("a lost publishing response becomes uncertain and never schedules another external publish", async () => {
  await duePost();
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new TypeError(
      "Fixture lost response containing sensitive provider details",
    );
  });
  assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), false);
  assert.equal(calls, 1);
  const [delivery] = await sql`SELECT state,error FROM post_deliveries`;
  assert.equal(delivery.state, "uncertain");
  assert.ok(!delivery.error.includes("sensitive"));
});

test("a multi-account request retains partial success without publishing either account twice", async () => {
  const admin = await duePost();
  const [group] = await sql<{ id: string; idempotencyKey: string }[]>`
    SELECT id,idempotency_key FROM post_groups`;
  const [first] = await sql<
    { id: string }[]
  >`SELECT id FROM social_connections`;
  const secondId = randomUUID();
  await sql`INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,encrypted_credentials)
    VALUES(${secondId},(SELECT id FROM workspace),'x','second-user','Second account','second',
      ${seal({ accessToken: "disposable-second-access", issuedAt: Date.now(), expiresAt: Date.now() + 3_600_000 }, `social-connection:${secondId}`)})`;
  const edited = await request(`/api/posts/${group.id}`, {
    cookie: admin.cookie,
    method: "PATCH",
    body: {
      text: "Safe local delivery verification",
      connectionIds: [first.id, secondId],
      mediaIds: [],
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      version: 1,
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(edited.status, 200);
  await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second' WHERE group_id=${group.id}`;
  const attempts = new Map<string, number>();
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(urlOf(input).href, "https://api.x.com/2/tweets");
      const token = new Headers(init?.headers).get("Authorization") ?? "";
      attempts.set(token, (attempts.get(token) ?? 0) + 1);
      return token === "Bearer disposable-access"
        ? json({ data: { id: "published-first" } }, 201)
        : json({ error: "Private rejection details" }, 422);
    },
  );
  assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), false);
  assert.deepEqual([...attempts.values()], [1, 1]);
  const history = await (
    await request("/api/posts?view=history", { cookie: admin.cookie })
  ).json();
  assert.equal(history.total, 1);
  const post = history.items[0];
  assert.equal(post.state, "partial");
  assert.equal(post.idempotencyKey, group.idempotencyKey);
  assert.deepEqual(
    post.deliveries.map((delivery: { state: string }) => delivery.state).sort(),
    ["failed", "published"],
  );
  const failed = post.deliveries.find(
    (delivery: { state: string }) => delivery.state === "failed",
  );
  assert.ok(!failed.error.includes("Private"));
});

test("a definitive provider rejection is failed, while expired authorization marks the account for reconnect", async () => {
  await duePost();
  mock.method(globalThis, "fetch", async () =>
    json({ error: "private provider message" }, 401),
  );
  await deliverNext();
  const [delivery] = await sql`SELECT state,error FROM post_deliveries`;
  const [connection] = await sql`SELECT state FROM social_connections`;
  assert.equal(delivery.state, "failed");
  assert.equal(connection.state, "reauthentication_required");
  assert.ok(!delivery.error.includes("private"));
});

test("an expired LinkedIn refresh grant requires reconnection before the worker can attempt publication", async () => {
  await duePost();
  const [connection] = await sql<
    { id: string }[]
  >`SELECT id FROM social_connections`;
  await sql`UPDATE social_connections SET provider='linkedin',encrypted_credentials=${seal({ accessToken: "expired", refreshToken: "revoked-refresh", expiresAt: 1, issuedAt: 1 }, `social-connection:${connection.id}`)} WHERE id=${connection.id}`;
  let requests = 0;
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    assert.equal(
      urlOf(input).href,
      "https://www.linkedin.com/oauth/v2/accessToken",
    );
    requests++;
    return json(
      {
        error: "invalid_request",
        error_description: "Private expired grant details",
      },
      400,
    );
  });
  await deliverNext();
  const [delivery] = await sql`SELECT state,error FROM post_deliveries`;
  const [updated] = await sql`SELECT state FROM social_connections`;
  assert.equal(delivery.state, "failed");
  assert.equal(updated.state, "reauthentication_required");
  assert.ok(!delivery.error.includes("Private"));
  assert.equal(requests, 1);
});

function job(provider: DeliveryJob["provider"]): DeliveryJob {
  return {
    id: randomUUID(),
    groupId: randomUUID(),
    workspaceId: randomUUID(),
    connectionId: randomUUID(),
    leaseToken: randomUUID(),
    provider,
    text: "Team announcement",
    accountId: "example-account",
    encryptedCredentials: "unused",
  };
}
test("LinkedIn prepares images and publishes with the fixed API version despite a legacy environment override", async (t) => {
  const previousVersion = process.env.POSTED_LINKEDIN_API_VERSION;
  process.env.POSTED_LINKEDIN_API_VERSION = "203001";
  t.after(() => {
    if (previousVersion === undefined)
      delete process.env.POSTED_LINKEDIN_API_VERSION;
    else process.env.POSTED_LINKEDIN_API_VERSION = previousVersion;
  });
  const requests: string[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input);
      requests.push(url.pathname);
      if (url.pathname.startsWith("/rest/"))
        assert.equal(
          new Headers(init?.headers).get("LinkedIn-Version"),
          "202609",
        );
      if (url.pathname === "/rest/images")
        return json({
          value: {
            image: "urn:li:image:fixture",
            uploadUrl: "https://www.linkedin.com/upload/fixture",
          },
        });
      if (url.pathname === "/upload/fixture") {
        assert.equal(init?.method, "PUT");
        return new Response(null, { status: 201 });
      }
      if (url.pathname === "/rest/posts") {
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.author, "urn:li:person:example-account");
        assert.equal(payload.content.media.id, "urn:li:image:fixture");
        assert.equal(
          new Headers(init?.headers).get("X-Restli-Protocol-Version"),
          "2.0.0",
        );
        return new Response(null, {
          status: 201,
          headers: { "x-restli-id": "urn:li:share:fixture" },
        });
      }
      throw new Error("Unexpected LinkedIn request");
    },
  );
  const prepared = await preparePublication(
    job("linkedin"),
    [
      {
        id: randomUUID(),
        bytes: Buffer.from("prepared-image"),
        width: 100,
        height: 100,
        alt: "A team image",
      },
    ],
    "fixture-token",
  );
  assert.deepEqual(requests, ["/rest/images", "/upload/fixture"]);
  assert.equal((await prepared.publish()).id, "urn:li:share:fixture");
  assert.equal(requests.length, 3);
});

test("LinkedIn cannot direct image uploads to an unrelated host", async () => {
  mock.method(globalThis, "fetch", async () =>
    json({
      value: {
        image: "urn:li:image:fixture",
        uploadUrl: "https://untrusted.example/upload",
      },
    }),
  );
  await assert.rejects(
    preparePublication(
      job("linkedin"),
      [
        {
          id: randomUUID(),
          bytes: Buffer.from("image"),
          width: 100,
          height: 100,
          alt: "",
        },
      ],
      "fixture-token",
    ),
    /unexpected upload destination/,
  );
});

test("Threads prepares a processed container before publication and preserves success if permalink lookup fails", async () => {
  let published = false;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.pathname.endsWith("/threads")) {
        assert.equal(
          new URLSearchParams(String(init?.body)).get("media_type"),
          "IMAGE",
        );
        return json({ id: "container-1" });
      }
      if (url.pathname.endsWith("/container-1"))
        return json({ status: "FINISHED" });
      if (url.pathname.endsWith("/threads_publish")) {
        published = true;
        return json({ id: "threads-post-1" });
      }
      if (url.pathname.endsWith("/threads-post-1"))
        return json({ error: "not ready" }, 503);
      throw new Error("Unexpected Threads request");
    },
  );
  const prepared = await preparePublication(
    job("threads"),
    [
      {
        id: randomUUID(),
        bytes: Buffer.from("image"),
        width: 100,
        height: 100,
        alt: "Image",
        url: "https://storage.example/signed-image",
      },
    ],
    "fixture-token",
  );
  assert.equal(published, false);
  const result = await prepared.publish();
  assert.equal(published, true);
  assert.equal(result.id, "threads-post-1");
});

test("Bluesky OAuth binds callbacks to the initiating administrator, supports multiple team accounts and signs publishing requests with DPoP", async () => {
  const original = {
    api: process.env.POSTED_API_URL,
    web: process.env.POSTED_WEB_URL,
  };
  process.env.POSTED_API_URL = "https://posted-api.example.test";
  process.env.POSTED_WEB_URL = "https://posted.example.test";
  process.env.POSTED_BLUESKY_CLIENT_ID =
    "https://posted-api.example.test/social/bluesky/client-metadata.json";
  const key = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  }).privateKey.export({ format: "jwk" });
  process.env.POSTED_BLUESKY_PRIVATE_KEY_JWK = JSON.stringify(key);
  const did = "did:plc:abcdefghijklmnopqrstuvwx";
  let authorizingDid = did;
  const cid = "bafkreigh2akiscaildcf5go4k2f4i4u7lhzgxmxzjzzxtfa4u4ajp5z7ai";
  let status = 200;
  let uploads = 0;
  let publications = 0;
  let exchanges = 0;
  let refreshes = 0;
  let accessToken = "disposable-dpop-access";
  let challenge = "";
  let oauthState = "";
  let expectedReply:
    | {
        root: { uri: string; cid: string };
        parent: { uri: string; cid: string };
      }
    | undefined;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input);
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      if (url.origin === "https://bsky.example.test") {
        const body = new URLSearchParams(
          init?.body
            ? String(init.body)
            : input instanceof Request
              ? await input.text()
              : "",
        );
        const assertion = body.get("client_assertion");
        assert.ok(assertion);
        assert.equal(decodeProtectedHeader(assertion).alg, "ES256");
        assert.equal(
          decodeJwt(assertion).iss,
          process.env.POSTED_BLUESKY_CLIENT_ID,
        );
        assert.ok(headers.get("DPoP"));
        if (url.pathname === "/oauth/par") {
          assert.equal(body.get("code_challenge_method"), "S256");
          assert.equal(body.get("scope"), "atproto transition:generic");
          challenge = body.get("code_challenge") ?? "";
          oauthState = body.get("state") ?? "";
          return json(
            {
              request_uri: "urn:ietf:params:oauth:request_uri:fixture",
              expires_in: 600,
            },
            201,
          );
        }
        if (url.pathname === "/oauth/token") {
          if (body.get("grant_type") === "refresh_token") {
            refreshes++;
            assert.equal(body.get("refresh_token"), "disposable-refresh");
            accessToken = "disposable-refreshed-access";
          } else {
            exchanges++;
            assert.equal(body.get("grant_type"), "authorization_code");
            assert.equal(
              createHash("sha256")
                .update(body.get("code_verifier") ?? "")
                .digest("base64url"),
              challenge,
            );
          }
          return json({
            sub: authorizingDid,
            scope: "atproto transition:generic",
            access_token: accessToken,
            refresh_token: "disposable-refresh",
            token_type: "DPoP",
            expires_in: 3600,
          });
        }
        throw new Error("Unexpected Bluesky OAuth request");
      }
      if (url.origin === "https://video.bsky.app") {
        if (url.pathname.endsWith("startUpload")) {
          assert.equal(
            headers.get("Authorization"),
            "Bearer disposable-video-service",
          );
          return json({
            jobId: "video-job",
            partSizeBytes: 1024,
            partCount: 1,
          });
        }
        if (url.pathname.endsWith("uploadPart")) {
          assert.equal(url.searchParams.get("partNumber"), "1");
          return json({ partNumber: 1, sizeBytes: 14 });
        }
        assert.ok(url.pathname.endsWith("finishUpload"));
        return json({
          completedJobId: "video-job",
          jobStatus: {
            jobId: "video-job",
            state: "JOB_STATE_COMPLETED",
            blob: {
              $type: "blob",
              ref: { $link: cid },
              mimeType: "video/mp4",
              size: 14,
            },
          },
        });
      }
      assert.equal(url.origin, "https://pds.example.test");
      assert.equal(headers.get("Authorization"), `DPoP ${accessToken}`);
      const proof = headers.get("DPoP");
      assert.ok(proof);
      assert.equal(decodeProtectedHeader(proof).typ, "dpop+jwt");
      assert.equal(decodeProtectedHeader(proof).alg, "ES256");
      const payload = decodeJwt(proof);
      assert.equal(payload.htu, url.origin + url.pathname);
      assert.equal(
        payload.htm,
        ["getProfile", "describeServer", "getServiceAuth"].some((path) =>
          url.pathname.endsWith(path),
        )
          ? "GET"
          : "POST",
      );
      assert.equal(
        payload.ath,
        createHash("sha256").update(accessToken).digest("base64url"),
      );
      if (url.pathname === "/xrpc/app.bsky.actor.getProfile")
        return json({
          did: authorizingDid,
          handle:
            authorizingDid === did
              ? "example.bsky.social"
              : "second.bsky.social",
          displayName: "Example",
          followersCount: 1,
          followsCount: 1,
          postsCount: 1,
        });
      if (url.pathname === "/xrpc/com.atproto.server.describeServer")
        return json({
          did: "did:web:pds.example.test",
          availableUserDomains: [],
        });
      if (url.pathname === "/xrpc/com.atproto.server.getServiceAuth") {
        assert.equal(url.searchParams.get("aud"), "did:web:pds.example.test");
        assert.equal(
          url.searchParams.get("lxm"),
          "com.atproto.repo.uploadBlob",
        );
        assert.ok(Number.isInteger(Number(url.searchParams.get("exp"))));
        return json({ token: "disposable-video-service" });
      }
      if (url.pathname === "/xrpc/com.atproto.repo.uploadBlob") {
        uploads++;
        assert.equal(headers.get("Content-Type"), "image/jpeg");
        return json({
          blob: {
            $type: "blob",
            ref: { $link: cid },
            mimeType: "image/jpeg",
            size: 14,
          },
        });
      }
      if (url.pathname === "/xrpc/com.atproto.repo.putRecord") {
        publications++;
        const body = init?.body
          ? String(init.body)
          : input instanceof Request
            ? await input.text()
            : "";
        const record = JSON.parse(body);
        assert.equal(record.repo, did);
        assert.equal(record.collection, "app.bsky.feed.post");
        assert.equal(record.record.text, "Team announcement");
        assert.deepEqual(record.record.reply, expectedReply);
        if (record.record.embed.$type === "app.bsky.embed.video") {
          assert.equal(record.record.embed.video.mimeType, "video/mp4");
          assert.equal(record.record.embed.alt, "Team video");
        } else {
          assert.equal(record.record.embed.images[0].alt, "Team artwork");
          assert.equal(record.record.embed.images[0].aspectRatio.width, 400);
        }
        if (status === 0)
          throw new TypeError("Sensitive fixture network details");
        if (status !== 200)
          return Response.json(
            {
              error: "FixtureRejected",
              message: "Sensitive fixture provider details",
            },
            { status, headers: { "Retry-After": "120" } },
          );
        return json({
          uri: `at://${did}/app.bsky.feed.post/${record.rkey}`,
          cid,
        });
      }
      throw new Error("Unexpected Bluesky provider request");
    },
  );
  try {
    const client = await blueskyClient();
    const metadata = {
      issuer: "https://bsky.example.test",
      authorization_endpoint: "https://bsky.example.test/oauth/authorize",
      token_endpoint: "https://bsky.example.test/oauth/token",
      pushed_authorization_request_endpoint:
        "https://bsky.example.test/oauth/par",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["private_key_jwt"],
      token_endpoint_auth_signing_alg_values_supported: ["ES256"],
      dpop_signing_alg_values_supported: ["ES256"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["atproto", "transition:generic"],
    };
    const resolvedInputs: string[] = [];
    mock.method(client.oauthResolver, "resolve", async (input: string) => {
      resolvedInputs.push(input);
      return { metadata };
    });
    mock.method(client.oauthResolver, "resolveFromIdentity", async () => ({
      metadata,
      pds: new URL("https://pds.example.test"),
    }));
    mock.method(
      client.oauthResolver,
      "getAuthorizationServerMetadata",
      async () => metadata,
    );
    const admin = await setupUser();
    const clientMetadataResponse = await request(
      "/social/bluesky/client-metadata.json",
    );
    assert.equal(clientMetadataResponse.status, 200);
    const clientMetadata = await clientMetadataResponse.json();
    assert.ok(
      !clientMetadata.client_uri ||
        new URL(clientMetadata.client_uri).origin ===
          new URL(clientMetadata.client_id).origin,
      "Bluesky requires the client homepage to share the client ID origin",
    );
    const serverStart = await request("/api/social/connect/bluesky", {
      cookie: admin.cookie,
      body: { handle: "https://pds.example.test/" },
    });
    assert.equal(serverStart.status, 200);
    assert.equal(resolvedInputs.at(-1), "https://pds.example.test");
    const rejectedServer = await request("/api/social/connect/bluesky", {
      cookie: admin.cookie,
      body: { handle: "https://127.0.0.1" },
    });
    assert.equal(rejectedServer.status, 400);
    for (const [error, status, message] of [
      [new OAuthResolverError("private diagnostic"), 400, "could not find"],
      [
        new OAuthResponseError(new Response(null, { status: 400 }), {
          error: "invalid_client_metadata",
          error_description: "private diagnostic",
        }),
        502,
        "OAuth configuration",
      ],
    ] as const) {
      const failure = mock.method(client, "authorize", async () => {
        throw error;
      });
      const result = await request("/api/social/connect/bluesky", {
        cookie: admin.cookie,
        body: { handle: "name.bsky.social" },
      });
      assert.equal(result.status, status);
      const response = await result.json();
      assert.ok(response.error.message.includes(message));
      assert.ok(!JSON.stringify(response).includes("private diagnostic"));
      failure.mock.restore();
    }
    const start = await request("/api/social/connect/bluesky", {
      cookie: admin.cookie,
      body: { handle: "example.bsky.social" },
    });
    assert.equal(start.status, 200);
    const authorization = new URL((await start.json()).authorizationUrl);
    assert.equal(authorization.origin, "https://bsky.example.test");
    assert.equal(
      authorization.searchParams.get("request_uri"),
      "urn:ietf:params:oauth:request_uri:fixture",
    );
    const callback = `/api/social/callback/bluesky?${new URLSearchParams({ state: oauthState, code: "disposable-code", iss: "https://bsky.example.test" })}`;
    const secondId = randomUUID();
    await sql`INSERT INTO users(id,workspace_id,name,email,password_hash,email_verified,role)
      SELECT ${secondId},workspace_id,'Second admin','second@example.test',password_hash,true,'admin'
      FROM users WHERE id=${admin.user.id}`;
    const login = await request("/api/auth/login", {
      body: {
        email: "second@example.test",
        password: "Secure test passphrase 42!",
      },
    });
    assert.equal(login.status, 200);
    const secondCookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(secondCookie);
    assert.equal(
      (await request(callback, { cookie: secondCookie })).status,
      400,
    );
    assert.equal(exchanges, 0);
    const [beforeExchange] =
      await sql`SELECT count(*)::integer AS count FROM bluesky_oauth_sessions`;
    assert.equal(beforeExchange.count, 0);
    assert.equal(
      (await request(callback, { cookie: admin.cookie })).status,
      302,
    );
    assert.equal(exchanges, 1);
    assert.equal(
      (await request(callback, { cookie: admin.cookie })).status,
      400,
    );
    assert.equal(exchanges, 1);
    const [connection] =
      await sql`SELECT workspace_id,encrypted_credentials FROM social_connections WHERE provider='bluesky'`;
    assert.equal(connection.workspaceId, admin.body.workspace.id);
    assert.ok(!connection.encryptedCredentials.includes(did));
    assert.equal((await client.restore(did, true)).did, did);
    assert.equal(refreshes, 1);
    authorizingDid = "did:plc:zyxwvutsrqponmlkjihgfedc";
    const secondStart = await request("/api/social/connect/bluesky", {
      cookie: admin.cookie,
      body: { handle: "second.bsky.social" },
    });
    assert.equal(secondStart.status, 200);
    const secondCallback = `/api/social/callback/bluesky?${new URLSearchParams({ state: oauthState, code: "second-disposable-code", iss: "https://bsky.example.test" })}`;
    assert.equal(
      (await request(secondCallback, { cookie: admin.cookie })).status,
      302,
    );
    assert.equal(exchanges, 2);
    const accounts =
      await sql`SELECT workspace_id,account_id FROM social_connections WHERE provider='bluesky' ORDER BY account_id`;
    assert.deepEqual(
      accounts.map((account) => account.accountId).sort(),
      [did, authorizingDid].sort(),
    );
    assert.ok(
      accounts.every(
        (account) => account.workspaceId === admin.body.workspace.id,
      ),
    );
    assert.equal((await client.restore(authorizingDid)).did, authorizingDid);
    authorizingDid = did;
    const publicKeys = await request("/social/bluesky/jwks.json");
    assert.equal(publicKeys.status, 200);
    for (const published of (await publicKeys.json()).keys) {
      assert.ok(published.x);
      assert.equal(published.d, undefined);
    }
    const delivery = { ...job("bluesky"), accountId: did };
    const prepared = await preparePublication(delivery, [
      {
        id: randomUUID(),
        bytes: Buffer.from("prepared-image"),
        width: 400,
        height: 200,
        alt: "Team artwork",
      },
    ]);
    assert.equal(uploads, 1);
    assert.equal(publications, 0);
    assert.deepEqual(prepared.checkpoint, { rkey: `posted-${delivery.id}` });
    assert.equal(
      (await prepared.publish()).id,
      `at://${did}/app.bsky.feed.post/posted-${delivery.id}`,
    );
    for (const rejection of [400, 401, 403, 408, 429, 503, 0]) {
      status = rejection;
      await assert.rejects(prepared.publish(), (error) => {
        assert.ok(error instanceof ProviderFailure);
        assert.equal(error.status, rejection === 0 ? 500 : rejection);
        assert.equal(
          error.uncertain,
          rejection === 0 || rejection === 408 || rejection >= 500,
        );
        if (rejection === 429) assert.equal(error.retryAfterMs, 120000);
        assert.ok(!error.message.includes("Sensitive"));
        return true;
      });
    }
    const [row] =
      await sql`SELECT value FROM bluesky_oauth_sessions WHERE key=${did}`;
    assert.ok(!row.value.includes(accessToken));
    assert.equal(publications, 8);
    status = 200;
    const videoJob = { ...job("bluesky"), accountId: did };
    const preparedVideo = await preparePublication(videoJob, [video()]);
    assert.equal(publications, 8);
    assert.equal(
      (await preparedVideo.publish()).id,
      `at://${did}/app.bsky.feed.post/posted-${videoJob.id}`,
    );
    assert.equal(publications, 9);
    const root = {
      id: `at://${did}/app.bsky.feed.post/posted-${delivery.id}`,
      cid,
    };
    let parent = root;
    for (let index = 1; index <= 2; index++) {
      const next = {
        ...job("bluesky"),
        accountId: did,
        postIndex: index,
        replyTo: parent,
        threadRoot: root,
      };
      expectedReply = {
        root: { uri: root.id, cid },
        parent: { uri: parent.id, cid },
      };
      const reply = await preparePublication(next, [video()]);
      const result = await reply.publish();
      assert.equal(result.cid, cid);
      parent = { id: result.id, cid };
    }
    assert.equal(publications, 11);
  } finally {
    process.env.POSTED_API_URL = original.api;
    process.env.POSTED_WEB_URL = original.web;
    delete process.env.POSTED_BLUESKY_CLIENT_ID;
    delete process.env.POSTED_BLUESKY_PRIVATE_KEY_JWK;
  }
});

function video(): DeliveryVideo {
  return {
    kind: "video",
    id: randomUUID(),
    bytes: Buffer.from("prepared-video"),
    width: 1280,
    height: 720,
    durationSeconds: 10,
    alt: "Team video",
    url: "https://storage.example.test/private-video?signature=disposable",
  };
}
test("X completes chunked video processing before the publishing boundary", async () => {
  const media = { ...video(), bytes: Buffer.alloc(4 * 1024 * 1024 + 5, 1) };
  const chunks: Buffer[] = [];
  let publishes = 0;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (url.pathname.endsWith("initialize")) {
        assert.equal(body.media_category, "tweet_video");
        assert.equal(body.total_bytes, media.bytes.length);
        return json({ data: { id: "123" } });
      }
      if (url.pathname.endsWith("append")) {
        assert.equal(body.segment_index, chunks.length);
        chunks.push(Buffer.from(body.media, "base64"));
        return json({ data: {} });
      }
      if (url.pathname.endsWith("finalize"))
        return json({
          data: { processing_info: { state: "pending", check_after_secs: 0 } },
        });
      if (url.pathname === "/2/media/upload") {
        assert.equal(url.searchParams.get("media_id"), "123");
        assert.equal(url.searchParams.get("command"), "STATUS");
        return json({ data: { processing_info: { state: "succeeded" } } });
      }
      assert.equal(url.pathname, "/2/tweets");
      publishes++;
      assert.deepEqual(body.media.media_ids, ["123"]);
      return json({ data: { id: "posted-video" } });
    },
  );
  const prepared = await preparePublication(job("x"), [media], "disposable");
  assert.equal(publishes, 0);
  assert.deepEqual(Buffer.concat(chunks), media.bytes);
  assert.equal((await prepared.publish()).id, "posted-video");
  assert.equal(publishes, 1);
});
test("failed video processing never reaches X publishing", async () => {
  let publishes = 0;
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = urlOf(input);
    if (url.pathname.endsWith("initialize"))
      return json({ data: { id: "123" } });
    if (url.pathname.endsWith("append")) return json({ data: {} });
    if (url.pathname.endsWith("finalize"))
      return json({ data: { processing_info: { state: "failed" } } });
    publishes++;
    throw new Error("Publishing should not be called");
  });
  await assert.rejects(preparePublication(job("x"), [video()], "disposable"));
  assert.equal(publishes, 0);
});
test("LinkedIn finalizes all video parts and waits for AVAILABLE before publishing", async () => {
  const media = video();
  const chunks: Buffer[] = [];
  let publishes = 0;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.searchParams.get("action") === "initializeUpload")
        return json({
          value: {
            video: "urn:li:video:fixture",
            uploadToken: "disposable-upload",
            uploadInstructions: [
              {
                firstByte: 0,
                lastByte: 4,
                uploadUrl: "https://www.linkedin.com/parts/0",
              },
              {
                firstByte: 5,
                lastByte: media.bytes.length - 1,
                uploadUrl: "https://www.linkedin.com/parts/1",
              },
            ],
          },
        });
      if (url.pathname.startsWith("/parts/")) {
        chunks.push(Buffer.from(init?.body as Uint8Array));
        return new Response(null, {
          status: 200,
          headers: { etag: `"part-${chunks.length}"` },
        });
      }
      if (url.searchParams.get("action") === "finalizeUpload") {
        assert.deepEqual(
          JSON.parse(String(init?.body)).finalizeUploadRequest.uploadedPartIds,
          ["part-1", "part-2"],
        );
        return new Response(null, { status: 200 });
      }
      if (url.pathname.startsWith("/rest/videos/"))
        return json({ status: "AVAILABLE" });
      assert.equal(url.pathname, "/rest/posts");
      assert.deepEqual(JSON.parse(String(init?.body)).content.media, {
        id: "urn:li:video:fixture",
      });
      publishes++;
      return new Response(null, {
        status: 201,
        headers: { "x-restli-id": "urn:li:share:video" },
      });
    },
  );
  const prepared = await preparePublication(
    job("linkedin"),
    [media],
    "disposable",
  );
  assert.equal(publishes, 0);
  assert.deepEqual(Buffer.concat(chunks), media.bytes);
  assert.equal((await prepared.publish()).id, "urn:li:share:video");
});
test("Threads prepares mixed image and video carousel children before publishing", async () => {
  const kinds: string[] = [];
  let publishes = 0;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.pathname.endsWith("/threads")) {
        const body = new URLSearchParams(String(init?.body));
        const kind = body.get("media_type");
        assert.ok(kind);
        kinds.push(kind);
        if (kind === "VIDEO") {
          assert.equal(body.get("video_url"), video().url);
          assert.equal(body.has("image_url"), false);
        }
        if (kind === "CAROUSEL") assert.equal(body.get("children"), "1,2");
        return json({ id: String(kinds.length) });
      }
      if (url.searchParams.get("fields") === "id,status")
        return json({ status: "FINISHED" });
      if (url.pathname.endsWith("threads_publish")) {
        publishes++;
        return json({ id: "published-video" });
      }
      return json({ permalink: "https://www.threads.net/@example/post/video" });
    },
  );
  const image = {
    id: randomUUID(),
    bytes: Buffer.from("image"),
    width: 100,
    height: 100,
    alt: "Image",
    url: "https://storage.example.test/image",
  };
  const prepared = await preparePublication(
    job("threads"),
    [image, video()],
    "disposable",
  );
  assert.deepEqual(kinds, ["IMAGE", "VIDEO", "CAROUSEL"]);
  assert.equal(publishes, 0);
  assert.equal((await prepared.publish()).id, "published-video");
});
