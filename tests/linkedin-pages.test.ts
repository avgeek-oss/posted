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
import { linkedInPages } from "../apps/api/src/social/linkedin-pages.js";
import { unseal } from "../apps/api/src/social/secrets.js";
import { enabledProviders } from "../apps/api/src/social/capabilities.js";
import { config } from "../apps/api/src/config.js";
import type {
  SocialConnection,
  Post,
} from "../packages/contracts/src/index.js";
import { deliverNext } from "../apps/worker/src/delivery.js";

process.env.POSTED_LINKEDIN_PAGES_CLIENT_ID = "pages-client";
process.env.POSTED_LINKEDIN_PAGES_CLIENT_SECRET = "pages-secret";
beforeEach(resetDatabase);
afterEach(() => mock.restoreAll());
after(cleanupDatabase);
const avatar = "https://media.licdn.com/dms/image/fixture";
let revoked = false;
function provider() {
  revoked = false;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/oauth/v2/accessToken") {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("client_id"), "pages-client");
        assert.equal(body.get("client_secret"), "pages-secret");
        assert.equal(
          body.get("redirect_uri"),
          `${process.env.POSTED_API_URL}/api/social/callback/linkedin-pages`,
        );
        return Response.json({ access_token: "pages-token", expires_in: 3600 });
      }
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer pages-token",
      );
      assert.equal(
        new Headers(init?.headers).get("LinkedIn-Version"),
        "202609",
      );
      if (url.pathname === "/rest/organizationAcls")
        return Response.json({
          elements: revoked
            ? []
            : [
                {
                  organization: "urn:li:organization:123",
                  role: "ADMINISTRATOR",
                  state: "APPROVED",
                },
                {
                  organizationTarget: "urn:li:organization:456",
                  role: "CONTENT_ADMINISTRATOR",
                  state: "APPROVED",
                },
                {
                  organization: "urn:li:organization:789",
                  role: "ANALYST",
                  state: "APPROVED",
                },
                {
                  organization: "urn:li:organization:999",
                  role: "ADMINISTRATOR",
                  state: "REVOKED",
                },
              ],
          paging: { start: 0, total: 4 },
        });
      if (url.pathname.startsWith("/rest/organizations/")) {
        const id = Number(url.pathname.split("/").at(-1));
        return Response.json({
          id,
          localizedName: `Page ${id}`,
          vanityName: `page-${id}`,
          logoV2: {
            "original~": {
              elements: [{ identifiers: [{ identifier: avatar }] }],
            },
          },
        });
      }
      if (url.pathname === "/rest/posts") {
        const value = JSON.parse(String(init?.body));
        assert.equal(value.author, "urn:li:organization:123");
        return new Response(null, {
          status: 201,
          headers: { "x-restli-id": `urn:li:share:${randomUUID()}` },
        });
      }
      throw new Error(`Unexpected LinkedIn request: ${url.pathname}`);
    },
  );
}
async function begin(cookie: string) {
  const response = await request("/api/social/connect/linkedin-pages", {
    cookie,
    body: {},
  });
  assert.equal(response.status, 200);
  const authorization = new URL((await response.json()).authorizationUrl);
  assert.equal(authorization.origin, "https://www.linkedin.com");
  assert.equal(authorization.searchParams.get("client_id"), "pages-client");
  assert.equal(
    authorization.searchParams.get("scope"),
    "rw_organization_admin w_organization_social",
  );
  const callback = `/api/social/callback/linkedin-pages?state=${authorization.searchParams.get("state")}&code=fixture`;
  return callback;
}
async function grant(cookie: string) {
  const callback = await begin(cookie);
  const response = await request(callback, { cookie });
  assert.equal(response.status, 302);
  const id = new URL(response.headers.get("location")!).searchParams.get(
    "linkedinPages",
  );
  assert.ok(id);
  return { callback, path: `/api/social/linkedin-pages/authorizations/${id}` };
}
test("LinkedIn Pages requires its own complete configuration", () => {
  const env = {
    POSTED_LINKEDIN_CLIENT_ID: "member",
    POSTED_LINKEDIN_CLIENT_SECRET: "member-secret",
  };
  assert.deepEqual(
    enabledProviders(env).map((p) => p.id),
    ["linkedin"],
  );
  assert.equal(
    enabledProviders({ ...env, POSTED_LINKEDIN_PAGES_CLIENT_ID: "pages" }).some(
      (p) => p.id === "linkedin-pages",
    ),
    false,
  );
  assert.ok(
    enabledProviders({
      ...env,
      POSTED_LINKEDIN_PAGES_CLIENT_ID: "pages",
      POSTED_LINKEDIN_PAGES_CLIENT_SECRET: "secret",
    }).some((p) => p.id === "linkedin-pages"),
  );
  assert.equal(config().POSTED_LINKEDIN_PAGES_CLIENT_ID, "pages-client");
  const secret = process.env.POSTED_LINKEDIN_PAGES_CLIENT_SECRET;
  process.env.POSTED_LINKEDIN_PAGES_CLIENT_SECRET = "";
  try {
    assert.throws(() => config());
  } finally {
    process.env.POSTED_LINKEDIN_PAGES_CLIENT_SECRET = secret;
  }
});
test("Page OAuth is bound to its administrator and saves only explicitly selected authorized Pages", async () => {
  const admin = await setupUser();
  provider();
  const callback = await begin(admin.cookie);
  const otherId = randomUUID();
  await sql`INSERT INTO users(id,workspace_id,name,email,password_hash,email_verified,role) SELECT ${otherId},workspace_id,'Other admin','other@example.test',password_hash,true,'admin' FROM users WHERE id=${admin.user.id}`;
  const login = await request("/api/auth/login", {
    body: {
      email: "other@example.test",
      password: "Secure test passphrase 42!",
    },
  });
  const otherCookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await request(callback, { cookie: otherCookie })).status, 400);
  const response = await request(callback, { cookie: admin.cookie });
  assert.equal(response.status, 302);
  const id = new URL(response.headers.get("location")!).searchParams.get(
    "linkedinPages",
  );
  const path = `/api/social/linkedin-pages/authorizations/${id}`;
  assert.equal((await request(callback, { cookie: admin.cookie })).status, 400);
  assert.equal((await request(path, { cookie: otherCookie })).status, 404);
  const list = await request(path, { cookie: admin.cookie });
  assert.equal(list.status, 200);
  const pages = await list.json();
  assert.deepEqual(
    pages.pages.map((p: { accountId: string }) => p.accountId),
    ["123", "456"],
  );
  assert.equal(JSON.stringify(pages).includes("pages-token"), false);
  assert.equal((await sql`SELECT id FROM social_connections`).length, 0);
  assert.equal(
    (
      await request(path, {
        cookie: admin.cookie,
        body: { accountIds: ["789"] },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(path, {
        cookie: admin.cookie,
        body: { accountIds: ["123", "123"] },
      })
    ).status,
    400,
  );
  const attempts = await Promise.all(
    [1, 2].map(() =>
      request(path, { cookie: admin.cookie, body: { accountIds: ["123"] } }),
    ),
  );
  assert.equal(attempts.filter((r) => r.status === 200).length, 1);
  const [account] = await sql`SELECT * FROM social_connections`;
  assert.equal(account.provider, "linkedin-pages");
  assert.equal(account.accountId, "123");
  assert.equal(account.avatarUrl, avatar);
  assert.equal(
    (
      unseal(
        account.encryptedCredentials,
        `social-connection:${account.id}`,
      ) as { accessToken: string }
    ).accessToken,
    "pages-token",
  );
  const second = await grant(admin.cookie);
  assert.equal(
    (
      await request(second.path, {
        cookie: admin.cookie,
        body: { accountIds: ["123", "456"] },
      })
    ).status,
    200,
  );
  assert.equal((await sql`SELECT id FROM social_connections`).length, 2);
  const [same] =
    await sql`SELECT * FROM social_connections WHERE account_id='123'`;
  assert.equal(same.id, account.id);
  assert.equal(
    (
      unseal(same.encryptedCredentials, `social-connection:${same.id}`) as {
        accessToken: string;
      }
    ).accessToken,
    "pages-token",
  );
  const ownGrant = await grant(admin.cookie);
  const otherGrant = await grant(otherCookie);
  const reconnects = await Promise.all([
    request(ownGrant.path, {
      cookie: admin.cookie,
      body: { accountIds: ["123"] },
    }),
    request(otherGrant.path, {
      cookie: otherCookie,
      body: { accountIds: ["123"] },
    }),
  ]);
  assert.ok(reconnects.every((response) => response.status === 200));
  const [reconnected] =
    await sql`SELECT * FROM social_connections WHERE account_id='123'`;
  assert.equal(reconnected.id, account.id);
  assert.equal(
    (
      unseal(
        reconnected.encryptedCredentials,
        `social-connection:${account.id}`,
      ) as { accessToken: string }
    ).accessToken,
    "pages-token",
  );
});
test("Page selection rechecks current access, expires, cancels without saving, and rejects a downgraded administrator", async () => {
  const admin = await setupUser();
  provider();
  const first = await grant(admin.cookie);
  revoked = true;
  assert.equal(
    (
      await request(first.path, {
        cookie: admin.cookie,
        body: { accountIds: ["123"] },
      })
    ).status,
    403,
  );
  revoked = false;
  assert.equal(
    (await request(first.path, { cookie: admin.cookie, method: "DELETE" }))
      .status,
    200,
  );
  assert.equal(
    (await request(first.path, { cookie: admin.cookie })).status,
    404,
  );
  const expired = await grant(admin.cookie);
  await sql`UPDATE linkedin_page_authorizations SET expires_at=now()-interval '1 second'`;
  assert.equal(
    (
      await request(expired.path, {
        cookie: admin.cookie,
        body: { accountIds: ["123"] },
      })
    ).status,
    404,
  );
  const downgrade = await grant(admin.cookie);
  await sql`UPDATE users SET role='member' WHERE id=${admin.user.id}`;
  assert.equal(
    (await request(downgrade.path, { cookie: admin.cookie })).status,
    403,
  );
  assert.equal(
    (
      await request(downgrade.path, {
        cookie: admin.cookie,
        body: { accountIds: ["123"] },
      })
    ).status,
    403,
  );
  assert.equal((await sql`SELECT id FROM social_connections`).length, 0);
});
test("Page grants deny unauthenticated requests and member OAuth initiation", async () => {
  assert.equal(
    (await request(`/api/social/linkedin-pages/authorizations/${randomUUID()}`))
      .status,
    401,
  );
  const admin = await setupUser();
  await sql`UPDATE users SET role='member' WHERE id=${admin.user.id}`;
  assert.equal(
    (
      await request("/api/social/connect/linkedin-pages", {
        cookie: admin.cookie,
        body: {},
      })
    ).status,
    403,
  );
});
test("Page deliveries use organization authors and publish multi-post sequences individually in order", async () => {
  const admin = await setupUser();
  provider();
  const selection = await grant(admin.cookie);
  await request(selection.path, {
    cookie: admin.cookie,
    body: { accountIds: ["123"] },
  });
  const accounts: { items: SocialConnection[] } = await (
    await request("/api/connections", { cookie: admin.cookie })
  ).json();
  const created = await request("/api/posts", {
    cookie: admin.cookie,
    body: {
      text: "First Page update",
      connectionIds: [accounts.items[0].id],
      mediaIds: [],
      additionalPosts: [{ text: "Second Page update", mediaIds: [] }],
      scheduledAt: new Date().toISOString(),
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(created.status, 201);
  const { post } = (await created.json()) as { post: Post };
  assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), true);
  assert.equal(await deliverNext(), false);
  const result = (await (
    await request(`/api/posts/${post.id}`, { cookie: admin.cookie })
  ).json()) as { post: Post };
  assert.equal(result.post.state, "published");
  assert.ok(result.post.deliveries.every((d) => d.state === "published"));
});

test("Page discovery reads every ACL page, deduplicates organizations, and never follows provider-supplied links", async () => {
  const cursors: number[] = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://api.linkedin.com");
    if (url.pathname === "/rest/organizationAcls") {
      const start = Number(url.searchParams.get("start"));
      cursors.push(start);
      return Response.json({
        elements:
          start === 0
            ? Array.from({ length: 100 }, () => ({
                organization: "urn:li:organization:123",
                role: "ADMINISTRATOR",
                state: "APPROVED",
              }))
            : [
                {
                  organizationTarget: "urn:li:organization:456",
                  role: "CONTENT_ADMIN",
                  state: "APPROVED",
                },
              ],
        paging: {
          start,
          total: 101,
          links: [{ rel: "next", href: "https://untrusted.example/leak" }],
        },
      });
    }
    const id = Number(url.pathname.split("/").at(-1));
    return Response.json({ id, localizedName: `Page ${id}` });
  });
  const pages = await linkedInPages("pages-token");
  assert.deepEqual(cursors, [0, 100]);
  assert.deepEqual(
    pages.map((page) => page.accountId),
    ["123", "456"],
  );
  assert.equal(pages[0].handle, "123");
  assert.equal(pages[0].avatarUrl, null);
});
