import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanupDatabase,
  request,
  resetDatabase,
  setupUser,
  sql,
} from "./support.js";
import { createPreviewApi } from "../tools/preview-api.js";
import { unseal } from "../apps/api/src/social/secrets.js";
import { enabledProviders } from "../apps/api/src/social/capabilities.js";

beforeEach(resetDatabase);
after(cleanupDatabase);

function fixtureRequest(
  path: string,
  cookie = "",
  body?: unknown,
  origin = process.env.POSTED_WEB_URL ?? "",
) {
  return new Request(`${process.env.POSTED_API_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("preview enables sample providers without enabling production OAuth", async () => {
  const { cookie } = await setupUser({ workspaceName: "Posted Preview" });
  const preview = await createPreviewApi();
  assert.equal(
    (await preview.fetch(fixtureRequest("/api/providers"))).status,
    401,
  );
  const response = await preview.fetch(
    fixtureRequest("/api/providers", cookie),
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    process.env.POSTED_WEB_URL,
  );
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload), ["providers"]);
  assert.deepEqual(payload.providers.map((p: { id: string }) => p.id).sort(), [
    "bluesky",
    "facebook-pages",
    "instagram",
    "linkedin",
    "linkedin-pages",
    "threads",
    "x",
  ]);
  const production = await request("/api/providers", { cookie });
  assert.deepEqual(
    (await production.json()).providers,
    enabledProviders(process.env),
  );
});

test("fixture connections remain team owned, unique and unusable for provider authentication", async () => {
  const { cookie, user } = await setupUser({ workspaceName: "Posted Preview" });
  const preview = await createPreviewApi();
  for (const provider of [
    "x",
    "x",
    "linkedin",
    "threads",
    "bluesky",
    "instagram",
  ]) {
    const response = await preview.fetch(
      fixtureRequest(
        `/api/social/connect/${provider}`,
        cookie,
        provider === "bluesky" ? { handle: "sample.bsky.social" } : {},
      ),
    );
    assert.equal(response.status, 200);
    const url = new URL((await response.json()).authorizationUrl);
    assert.equal(url.origin, process.env.POSTED_WEB_URL);
    assert.equal(url.pathname, "/connections/authorize");
    const state = url.searchParams.get("state");
    assert.ok(state);
    const before = (
      await sql`SELECT count(*)::int AS count FROM social_connections`
    )[0].count;
    const info = await preview.fetch(
      fixtureRequest(
        `/api/preview/social/authorization?${url.searchParams}`,
        cookie,
      ),
    );
    assert.equal(info.status, 200);
    assert.equal((await info.json()).provider, provider);
    assert.equal(
      (await sql`SELECT count(*)::int AS count FROM social_connections`)[0]
        .count,
      before,
    );
    const approval = await preview.fetch(
      fixtureRequest("/api/preview/social/decision", cookie, {
        provider,
        state,
        decision: "approve",
      }),
    );
    assert.equal(approval.status, 200);
    const callback = new URL((await approval.json()).authorizationUrl);
    const completed = await preview.fetch(
      fixtureRequest(callback.pathname + callback.search, cookie),
    );
    assert.equal(completed.status, 302);
    assert.equal(
      completed.headers.get("location"),
      `${process.env.POSTED_WEB_URL}/connections?connection=connected`,
    );
    assert.equal(
      (
        await preview.fetch(
          fixtureRequest(callback.pathname + callback.search, cookie),
        )
      ).status,
      400,
    );
  }
  const connections = await sql`SELECT * FROM social_connections`;
  assert.equal(connections.length, 6);
  assert.equal(new Set(connections.map((item) => item.accountId)).size, 6);
  for (const item of connections) {
    assert.equal(item.connectedBy, user.id);
    assert.equal(item.workspaceId, (await sql`SELECT id FROM workspace`)[0].id);
    assert.equal(
      (
        unseal(item.encryptedCredentials, `social-connection:${item.id}`) as {
          accessToken: string;
        }
      ).accessToken,
      "disposable-preview-not-a-provider-token",
    );
  }
  const list = await preview.fetch(fixtureRequest("/api/connections", cookie));
  assert.equal((await list.json()).items.length, 6);
  assert.equal(
    (
      await sql`SELECT count(*)::int AS count FROM social_oauth_requests WHERE consumed_at IS NOT NULL`
    )[0].count,
    6,
  );
});

test("preview approval denial, expired state and invalid codes never create a connection", async () => {
  const { cookie } = await setupUser({ workspaceName: "Posted Preview" });
  const preview = await createPreviewApi();
  const start = await preview.fetch(
    fixtureRequest("/api/social/connect/x", cookie, {}),
  );
  const url = new URL((await start.json()).authorizationUrl);
  const state = url.searchParams.get("state");
  const invalid = await preview.fetch(
    fixtureRequest(
      `/api/social/callback/x?state=${state}&code=not-approved`,
      cookie,
    ),
  );
  assert.equal(invalid.status, 400);
  const denial = await preview.fetch(
    fixtureRequest("/api/preview/social/decision", cookie, {
      provider: "x",
      state,
      decision: "deny",
    }),
  );
  assert.equal(denial.status, 200);
  const callback = new URL((await denial.json()).authorizationUrl);
  const denied = await preview.fetch(
    fixtureRequest(callback.pathname + callback.search, cookie),
  );
  assert.equal(denied.status, 302);
  assert.equal(
    denied.headers.get("location"),
    `${process.env.POSTED_WEB_URL}/connections?connection=denied`,
  );
  assert.equal(
    (
      await preview.fetch(
        fixtureRequest(callback.pathname + callback.search, cookie),
      )
    ).status,
    400,
  );
  const second = await preview.fetch(
    fixtureRequest("/api/social/connect/linkedin", cookie, {}),
  );
  const expired = new URL((await second.json()).authorizationUrl);
  await sql`UPDATE social_oauth_requests SET expires_at=now()-interval '1 second' WHERE consumed_at IS NULL`;
  assert.equal(
    (
      await preview.fetch(
        fixtureRequest(
          `/api/preview/social/authorization?${expired.searchParams}`,
          cookie,
        ),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await preview.fetch(
        fixtureRequest("/api/preview/social/decision", cookie, {
          provider: "linkedin",
          state: expired.searchParams.get("state"),
          decision: "approve",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await sql`SELECT count(*)::int AS count FROM social_connections`)[0].count,
    0,
  );
});

test("preview reconnects the same account through the shared callback and rejects role changes", async () => {
  const { cookie, user } = await setupUser({ workspaceName: "Posted Preview" });
  const preview = await createPreviewApi();
  for (let attempt = 0; attempt < 2; attempt++) {
    const start = await preview.fetch(
      fixtureRequest("/api/social/connect/bluesky", cookie, {
        handle: "sample.bsky.social",
      }),
    );
    const url = new URL((await start.json()).authorizationUrl);
    const approval = await preview.fetch(
      fixtureRequest("/api/preview/social/decision", cookie, {
        provider: "bluesky",
        state: url.searchParams.get("state"),
        decision: "approve",
      }),
    );
    const callback = new URL((await approval.json()).authorizationUrl);
    assert.equal(
      (
        await preview.fetch(
          fixtureRequest(callback.pathname + callback.search, cookie),
        )
      ).status,
      302,
    );
    assert.equal(
      (await sql`SELECT state FROM social_connections`)[0].state,
      "connected",
    );
    await sql`UPDATE social_connections SET state='reauthentication_required'`;
  }
  assert.equal(
    (await sql`SELECT count(*)::int AS count FROM social_connections`)[0].count,
    1,
  );
  const start = await preview.fetch(
    fixtureRequest("/api/social/connect/threads", cookie, {}),
  );
  const url = new URL((await start.json()).authorizationUrl);
  await sql`UPDATE users SET role='member' WHERE id=${user.id}`;
  assert.equal(
    (
      await preview.fetch(
        fixtureRequest("/api/preview/social/decision", cookie, {
          provider: "threads",
          state: url.searchParams.get("state"),
          decision: "approve",
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (await sql`SELECT count(*)::int AS count FROM social_connections`)[0].count,
    1,
  );
});

test("fixture connection mutations enforce origin, session, roles and validated provider input", async () => {
  const { cookie, user } = await setupUser({ workspaceName: "Posted Preview" });
  const preview = await createPreviewApi();
  for (const [path, session, body, origin, status] of [
    ["/api/social/connect/x", "", {}, process.env.POSTED_WEB_URL, 401],
    ["/api/social/connect/x", cookie, {}, "https://untrusted.example", 403],
    ["/api/social/connect/x", cookie, {}, "", 403],
    [
      "/api/social/connect/invalid",
      cookie,
      {},
      process.env.POSTED_WEB_URL,
      400,
    ],
    [
      "/api/social/connect/bluesky",
      cookie,
      { handle: "bad handle" },
      process.env.POSTED_WEB_URL,
      400,
    ],
    [
      "/api/social/connect/x",
      cookie,
      { userId: user.id },
      process.env.POSTED_WEB_URL,
      400,
    ],
  ] as const) {
    assert.equal(
      (await preview.fetch(fixtureRequest(path, session, body, origin))).status,
      status,
    );
  }
  for (const role of ["member", "viewer"]) {
    await sql`UPDATE users SET role=${role} WHERE id=${user.id}`;
    assert.equal(
      (await preview.fetch(fixtureRequest("/api/social/connect/x", cookie, {})))
        .status,
      403,
    );
  }
  assert.equal(
    (await sql`SELECT count(*)::int AS count FROM social_connections`)[0].count,
    0,
  );
});

test("preview refuses production, remote installations and ordinary workspaces", async () => {
  await setupUser({ workspaceName: "Posted Preview" });
  for (const [key, value] of [
    ["NODE_ENV", "production"],
    ["DATABASE_URL", "postgres://fixture@db.example/posted"],
    ["POSTED_WEB_URL", "https://posted.example"],
    ["POSTED_API_URL", "https://api.posted.example"],
  ]) {
    const original = process.env[key];
    try {
      process.env[key] = value;
      await assert.rejects(createPreviewApi(), /disposable loopback/);
    } finally {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  }
  const preview = await createPreviewApi();
  await sql`UPDATE workspace SET name='Real team'`;
  await assert.rejects(createPreviewApi(), /not the disposable preview/);
  const login = await request("/api/auth/login", {
    body: {
      email: "admin@example.test",
      password: "Secure test passphrase 42!",
    },
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.equal(
    (await preview.fetch(fixtureRequest("/api/social/connect/x", cookie, {})))
      .status,
    403,
  );
});

for (const provider of ["linkedin-pages", "facebook-pages"] as const)
  test(`preview ${provider} selection uses fixture discovery and never calls a real provider`, async () => {
    const { cookie } = await setupUser({ workspaceName: "Posted Preview" });
    const preview = await createPreviewApi();
    const start = await preview.fetch(
      fixtureRequest(`/api/social/connect/${provider}`, cookie, {}),
    );
    const authorization = new URL((await start.json()).authorizationUrl);
    const decision = await preview.fetch(
      fixtureRequest("/api/preview/social/decision", cookie, {
        provider,
        state: authorization.searchParams.get("state"),
        decision: "approve",
      }),
    );
    const callback = new URL((await decision.json()).authorizationUrl);
    const completed = await preview.fetch(
      fixtureRequest(callback.pathname + callback.search, cookie),
    );
    const id = new URL(completed.headers.get("location")!).searchParams.get(
      provider === "linkedin-pages" ? "linkedinPages" : "facebookPages",
    );
    const path = `/api/social/${provider}/authorizations/${id}`;
    assert.equal(
      (await preview.fetch(fixtureRequest(path, cookie))).status,
      200,
    );
    const saved = await preview.fetch(
      fixtureRequest(path, cookie, { accountIds: ["123456"] }),
    );
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { connected: 1 });
    const [account] = await sql`SELECT * FROM social_connections`;
    assert.equal(account.provider, provider);
    assert.equal(account.accountId, "123456");
    assert.equal(
      (
        unseal(
          account.encryptedCredentials,
          `social-connection:${account.id}`,
        ) as { accessToken: string }
      ).accessToken,
      "disposable-preview-not-a-provider-token",
    );
  });
