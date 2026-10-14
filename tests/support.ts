import { randomBytes } from "node:crypto";
import postgres from "postgres";
process.env.DATABASE_URL ??=
  "postgres://posted:posted-local-verification@127.0.0.1:55490/posted";
process.env.POSTED_WEB_URL ??= "http://localhost:4342";
process.env.POSTED_API_URL ??= "http://localhost:4341";
process.env.POSTED_SECRET ??=
  "posted-integration-only-32-byte-secret-never-production";
process.env.NODE_ENV = "test";
process.env.POSTED_DB_SCHEMA ??= `test_${randomBytes(8).toString("hex")}`;
const admin = postgres(process.env.DATABASE_URL, { max: 1 });
await admin.unsafe(
  `CREATE SCHEMA IF NOT EXISTS "${process.env.POSTED_DB_SCHEMA}"`,
);
await admin.end();
const { sql } = await import("../packages/database/src/index.js");
const { migrate } = await import("../packages/database/src/migrate.js");
await migrate();
export { sql };
const { installationSetupSecret } =
  await import("../apps/api/src/auth/setup-secret.js");
export const setupSecret = installationSetupSecret();
export async function resetDatabase() {
  const rows =
    await sql`SELECT tablename FROM pg_tables WHERE schemaname=${process.env.POSTED_DB_SCHEMA ?? ""} AND tablename<>'posted_migrations'`;
  if (rows.length)
    await sql.unsafe(
      `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(",")} RESTART IDENTITY CASCADE`,
    );
}
export async function cleanupDatabase() {
  await sql.unsafe(`DROP SCHEMA "${process.env.POSTED_DB_SCHEMA}" CASCADE`);
  await sql.end();
}
export async function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    cookie?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const { app } = await import("../apps/api/src/app.js");
  const headers: Record<string, string> = {
    Origin: process.env.POSTED_WEB_URL ?? "",
    "Content-Type": "application/json",
    ...options.headers,
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.cookie) headers.Cookie = options.cookie;
  return app.request(path, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}
export async function setupUser(overrides: Record<string, unknown> = {}) {
  const response = await request("/api/auth/setup", {
    body: {
      setupSecret,
      workspaceName: "Test workspace",
      name: "Admin",
      email: "admin@example.test",
      password: "Secure test passphrase 42!",
      ...overrides,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Setup failed: ${JSON.stringify(body)}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { cookie, body, user: body.user };
}
