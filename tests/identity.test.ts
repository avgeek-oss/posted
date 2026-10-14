import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  cleanupDatabase,
  request,
  resetDatabase,
  setupUser,
  sql,
} from "./support.js";

beforeEach(resetDatabase);
after(cleanupDatabase);

async function member(adminId: string) {
  const id = randomUUID();
  await sql`INSERT INTO users(id,workspace_id,name,email,password_hash,email_verified,role)
    SELECT ${id},workspace_id,'Team member','member@example.test',password_hash,true,'member' FROM users WHERE id=${adminId}`;
  const login = await request("/api/auth/login", {
    body: {
      email: "member@example.test",
      password: "Secure test passphrase 42!",
    },
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return { id, cookie };
}

test("account preferences persist without changing authority and sessions remain private", async () => {
  const admin = await setupUser();
  const other = await member(admin.user.id);
  const updated = await request("/api/auth/profile", {
    cookie: other.cookie,
    method: "PATCH",
    body: {
      name: "Updated member",
      timeZone: "Asia/Kolkata",
      dateFormat: "year-month-day",
      timeFormat: "12-hour",
    },
  });
  assert.equal(updated.status, 200);
  const me = await (
    await request("/api/auth/me", { cookie: other.cookie })
  ).json();
  assert.equal(me.user.name, "Updated member");
  assert.equal(me.user.timeZone, "Asia/Kolkata");
  assert.equal(me.user.dateFormat, "year-month-day");
  assert.equal(me.user.timeFormat, "12-hour");
  assert.equal(me.user.role, "member");
  assert.equal(
    (
      await request("/api/auth/profile", {
        cookie: other.cookie,
        method: "PATCH",
        body: { role: "admin" },
      })
    ).status,
    400,
  );
  const sessions = await (
    await request("/api/auth/sessions", { cookie: other.cookie })
  ).json();
  assert.equal(sessions.items.length, 1);
  assert.equal(sessions.items[0].current, true);
  assert.equal(
    (
      await request(`/api/auth/sessions/${sessions.items[0].id}`, {
        cookie: admin.cookie,
        method: "DELETE",
      })
    ).status,
    404,
  );
  assert.equal(
    (await request("/api/auth/logout", { cookie: other.cookie, body: {} }))
      .status,
    200,
  );
  assert.equal(
    (await request("/api/auth/me", { cookie: other.cookie })).status,
    401,
  );
  assert.equal(
    (await request("/api/auth/me", { cookie: admin.cookie })).status,
    200,
  );
});

test("personal and team API keys enforce ownership, permissions and revocation", async () => {
  const admin = await setupUser();
  const other = await member(admin.user.id);
  const input = {
    name: "Team automation",
    access: "edit",
    includeAdmin: true,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  };
  assert.equal(
    (
      await request("/api/team-credentials", {
        cookie: other.cookie,
        body: input,
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/credentials", { cookie: other.cookie, body: input }))
      .status,
    403,
  );
  const created = await request("/api/team-credentials", {
    cookie: admin.cookie,
    body: input,
  });
  assert.equal(created.status, 201);
  const key = await created.json();
  assert.equal(key.credential.userId, null);
  assert.equal(
    (await request("/api/connections", { token: key.token })).status,
    200,
  );
  assert.equal(
    (await request("/api/team-credentials", { token: key.token })).status,
    403,
  );
  assert.equal(
    (await request("/api/team-credentials", { cookie: other.cookie })).status,
    403,
  );
  const personal = await request("/api/credentials", {
    cookie: other.cookie,
    body: {
      ...input,
      name: "Read-only script",
      access: "read",
      includeAdmin: false,
    },
  });
  assert.equal(personal.status, 201);
  const readKey = await personal.json();
  assert.equal(
    (await request("/api/connections", { token: readKey.token })).status,
    200,
  );
  assert.equal(
    (await request("/api/posts", { token: readKey.token, body: {} })).status,
    403,
  );
  const adminKeys = await (
    await request("/api/credentials", { cookie: admin.cookie })
  ).json();
  assert.equal(adminKeys.items.length, 0);
  assert.equal(
    (
      await request(`/api/credentials/${readKey.credential.id}`, {
        cookie: admin.cookie,
        method: "DELETE",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/api/team-credentials/${key.credential.id}`, {
        cookie: admin.cookie,
        method: "DELETE",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/connections", { token: key.token })).status,
    401,
  );
});

test("team administration protects its last administrator and passkey enrollment binds to a current human session", async () => {
  const admin = await setupUser();
  const other = await member(admin.user.id);
  assert.equal(
    (
      await request(`/api/auth/members/${admin.user.id}`, {
        cookie: admin.cookie,
        method: "PATCH",
        body: { role: "viewer" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/api/workspace", {
        cookie: other.cookie,
        method: "PATCH",
        body: { name: "Renamed team" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/workspace", {
        cookie: admin.cookie,
        method: "PATCH",
        body: { name: "Renamed team" },
      })
    ).status,
    200,
  );
  const options = await request("/api/auth/passkeys/register/options", {
    cookie: other.cookie,
    body: {},
  });
  assert.equal(options.status, 200);
  const registration = await options.json();
  assert.equal(registration.options.rp.name, "Posted");
  assert.equal(
    registration.options.authenticatorSelection.userVerification,
    "required",
  );
  assert.ok(registration.options.challenge);
  const [challenge] =
    await sql`SELECT user_id,session_id,purpose FROM auth_challenges WHERE user_id=${other.id}`;
  assert.equal(challenge.userId, other.id);
  assert.equal(challenge.purpose, "registration");
  assert.ok(challenge.sessionId);
  assert.equal(
    (
      await request(`/api/auth/members/${other.id}`, {
        cookie: admin.cookie,
        method: "DELETE",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/auth/me", { cookie: other.cookie })).status,
    401,
  );
  assert.equal(
    (
      await sql`SELECT token_hash FROM auth_challenges WHERE user_id=${other.id}`
    ).length,
    0,
  );
});
