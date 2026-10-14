import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  sql,
  request,
  setupUser,
  resetDatabase,
  cleanupDatabase,
} from "./support.js";
import { app } from "../apps/api/src/app.js";

beforeEach(resetDatabase);
after(cleanupDatabase);
const resource = `${process.env.POSTED_API_URL}/mcp`;
const redirectUri = "http://127.0.0.1:49152/callback";
async function form(path: string, fields: Record<string, string>) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}
async function authorization(cookie: string, requestedScope = "read") {
  const registered = await request("/oauth/register", {
    body: {
      client_name: "Codex",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    },
  });
  assert.equal(registered.status, 201);
  const client = await registered.json();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    resource,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: requestedScope,
    state: "fixture-state",
  });
  const start = await request(`/oauth/authorize?${params}`);
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get("location") ?? "");
  assert.equal(location.origin, process.env.POSTED_WEB_URL);
  const id = location.searchParams.get("request");
  assert.ok(id);
  const details = await request(`/api/oauth/consent/${id}`, { cookie });
  assert.equal(details.status, 200);
  return {
    id,
    verifier,
    clientId: String(client.client_id),
    details: await details.json(),
  };
}
async function approve(
  cookie: string,
  accessLevel: "read" | "write" | "admin",
  requestedScope = "read",
) {
  const grant = await authorization(cookie, requestedScope);
  const decision = await request(`/api/oauth/consent/${grant.id}`, {
    cookie,
    body: { allow: true, accessLevel },
  });
  assert.equal(decision.status, 200);
  const callback = new URL((await decision.json()).redirectTo);
  assert.equal(callback.searchParams.get("state"), "fixture-state");
  assert.equal(callback.searchParams.get("iss"), process.env.POSTED_API_URL);
  const code = callback.searchParams.get("code");
  assert.ok(code);
  const exchangeFields = {
    grant_type: "authorization_code",
    client_id: grant.clientId,
    code,
    redirect_uri: redirectUri,
    resource,
    code_verifier: grant.verifier,
  };
  const exchange = await form("/oauth/token", exchangeFields);
  assert.equal(exchange.status, 200);
  return {
    token: String((await exchange.json()).access_token),
    grant,
    exchangeFields,
  };
}
async function mcp(token: string) {
  const client = new Client({ name: "posted-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) => app.fetch(new Request(input, init)),
  });
  await client.connect(transport);
  return client;
}

test("the user chooses administrator even when the client only requests read", async () => {
  const admin = await setupUser();
  const { token, grant } = await approve(admin.cookie, "admin");
  assert.deepEqual(grant.details.availableAccessLevels, [
    "read",
    "write",
    "admin",
  ]);
  const client = await mcp(token);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes("disconnect_account"));
    assert.ok(names.includes("create_post"));
    const changed = await client.callTool({
      name: "update_team",
      arguments: { name: "MCP team" },
    });
    assert.equal(changed.isError, false);
    assert.equal((await sql`SELECT name FROM workspace`)[0].name, "MCP team");
    assert.equal(
      (await request("/api/workspace", { token })).status,
      403,
      "resource-bound tokens cannot be used directly on REST",
    );
  } finally {
    await client.close();
  }
});

test("MCP preserves draft, create and edit request keys across retries", async () => {
  const admin = await setupUser();
  const { token } = await approve(admin.cookie, "write");
  const [connection] =
    await sql`INSERT INTO social_connections(workspace_id,provider,account_id,name,handle,encrypted_credentials) VALUES((SELECT id FROM workspace),'x',${randomUUID()},'Example','example','fixture') RETURNING id`;
  const client = await mcp(token);
  try {
    const draftId = randomUUID();
    const draft = {
      draftId,
      text: "",
      textOverrides: {},
      connectionIds: [],
      mediaIds: [],
      version: 0,
      idempotencyKey: randomUUID(),
    };
    for (let attempt = 0; attempt < 2; attempt++)
      assert.equal(
        (await client.callTool({ name: "save_draft", arguments: draft }))
          .isError,
        false,
      );
    assert.equal(
      (await client.callTool({ name: "get_draft", arguments: { draftId } }))
        .isError,
      false,
    );
    assert.equal(
      (await client.callTool({ name: "list_drafts", arguments: {} })).isError,
      false,
    );
    assert.equal((await sql`SELECT version FROM post_drafts`)[0].version, 1);
    assert.equal((await sql`SELECT id FROM post_deliveries`).length, 0);
    assert.equal(
      (
        await client.callTool({
          name: "save_draft",
          arguments: { ...draft, text: "Changed content" },
        })
      ).isError,
      true,
    );
    const mediaId = randomUUID();
    await sql`INSERT INTO post_media(id,workspace_id,created_by,object_key,file_name,content_type,size_bytes,width,height,duration_seconds,state) VALUES(${mediaId},(SELECT id FROM workspace),${admin.user.id},'fixture/video.mp4','video.mp4','video/mp4',14,1280,720,10,'ready')`;
    const input = {
      text: "Scheduled from MCP",
      connectionIds: [connection.id],
      mediaIds: [mediaId],
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      idempotencyKey: randomUUID(),
      draftSource: { id: draftId, version: 1 },
    };
    const created = await client.callTool({
      name: "create_post",
      arguments: input,
    });
    assert.equal(created.isError, false);
    const replay = await client.callTool({
      name: "create_post",
      arguments: input,
    });
    assert.equal(replay.isError, false);
    const [post] = await sql`SELECT * FROM post_groups`;
    assert.equal(post.idempotencyKey, input.idempotencyKey);
    assert.equal(post.lastEditedBy, admin.user.id);
    assert.equal((await sql`SELECT id FROM post_groups`).length, 1);
    assert.equal(
      (await sql`SELECT published_post_id FROM post_drafts`)[0].publishedPostId,
      post.id,
    );
    const memberId = randomUUID();
    await sql`INSERT INTO users(id,workspace_id,name,email,password_hash,email_verified,role) SELECT ${memberId},workspace_id,'MCP editor','mcp-editor@example.test',password_hash,true,'member' FROM users WHERE id=${admin.user.id}`;
    const login = await request("/api/auth/login", {
      body: {
        email: "mcp-editor@example.test",
        password: "Secure test passphrase 42!",
      },
    });
    assert.equal(login.status, 200);
    const memberCookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(memberCookie);
    const memberGrant = await approve(memberCookie, "write");
    const memberClient = await mcp(memberGrant.token);
    const edited = {
      ...input,
      postId: post.id,
      text: "Edited from MCP",
      version: 1,
      idempotencyKey: randomUUID(),
    };
    try {
      assert.equal(
        (
          await memberClient.callTool({
            name: "update_post",
            arguments: edited,
          })
        ).isError,
        false,
      );
    } finally {
      await memberClient.close();
    }
    assert.equal(
      (await client.callTool({ name: "update_post", arguments: edited }))
        .isError,
      false,
    );
    const [saved] =
      await sql`SELECT text,version,last_edited_by FROM post_groups WHERE id=${post.id}`;
    assert.equal(saved.text, edited.text);
    assert.equal(saved.version, 2);
    assert.equal(saved.lastEditedBy, memberId);
  } finally {
    await client.close();
  }
});

test("Read-only approval overrides a client's administrator request and cannot mutate", async () => {
  const admin = await setupUser();
  const { token } = await approve(admin.cookie, "read", "read write admin");
  const client = await mcp(token);
  try {
    const tools = (await client.listTools()).tools;
    assert.ok(tools.every((t) => t.annotations?.readOnlyHint));
    await assert.rejects(
      client.callTool({
        name: "update_team",
        arguments: { name: "Forbidden" },
      }),
    );
    assert.equal(
      (await sql`SELECT name FROM workspace`)[0].name,
      "Test workspace",
    );
  } finally {
    await client.close();
  }
});

test("role changes revoke issued MCP grants and invalidate reviewed approvals", async () => {
  const admin = await setupUser();
  const { token } = await approve(admin.cookie, "admin");
  const pending = await authorization(admin.cookie);
  await sql`UPDATE users SET role='member' WHERE id=${admin.user.id}`;
  assert.equal(
    (
      await request("/mcp", {
        token,
        body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        headers: { Accept: "application/json, text/event-stream" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request(`/api/oauth/consent/${pending.id}`, {
        cookie: admin.cookie,
        body: { allow: true, accessLevel: "admin" },
      })
    ).status,
    400,
  );
  const fresh = await authorization(admin.cookie);
  assert.deepEqual(fresh.details.availableAccessLevels, ["read", "write"]);
  assert.equal(
    (
      await request(`/api/oauth/consent/${fresh.id}`, {
        cookie: admin.cookie,
        body: { allow: true, accessLevel: "admin" },
      })
    ).status,
    403,
  );
});

test("wrong PKCE cannot redeem a code, and reusing a redeemed code revokes its token", async () => {
  const admin = await setupUser();
  const grant = await authorization(admin.cookie);
  const decision = await request(`/api/oauth/consent/${grant.id}`, {
    cookie: admin.cookie,
    body: { allow: true, accessLevel: "read" },
  });
  const callback = new URL((await decision.json()).redirectTo);
  const code = callback.searchParams.get("code");
  assert.ok(code);
  const fields = {
    grant_type: "authorization_code",
    client_id: grant.clientId,
    code,
    redirect_uri: redirectUri,
    resource,
    code_verifier: grant.verifier,
  };
  assert.equal(
    (
      await form("/oauth/token", {
        ...fields,
        code_verifier: randomBytes(32).toString("base64url"),
      })
    ).status,
    400,
  );
  const exchanged = await form("/oauth/token", fields);
  assert.equal(exchanged.status, 200);
  const token = String((await exchanged.json()).access_token);
  assert.equal((await form("/oauth/token", fields)).status, 400);
  assert.equal((await request("/mcp", { token })).status, 401);
});
