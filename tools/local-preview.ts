import { config } from "../apps/api/src/config.js";
import { app } from "../apps/api/src/app.js";
import { installationSetupSecret } from "../apps/api/src/auth/setup-secret.js";
import { sql } from "../packages/database/src/index.js";
import { migrate } from "../packages/database/src/migrate.js";
import { seal } from "../apps/api/src/social/secrets.js";
import { PROVIDERS } from "../packages/contracts/src/index.js";
import { hashPassword, verifyPassword } from "../apps/api/src/auth/security.js";

const previewAdminEmail = "local@avgeek.ltd";
const previewAdminPassword = "test123";

const settings = config();
if (
  settings.NODE_ENV === "production" ||
  !["localhost", "127.0.0.1"].includes(
    new URL(settings.DATABASE_URL).hostname,
  ) ||
  !["localhost", "127.0.0.1"].includes(
    new URL(settings.POSTED_API_URL).hostname,
  )
)
  throw new Error(
    "Preview fixtures require a disposable loopback installation",
  );
await migrate();
const [existing] = await sql`SELECT id,name FROM workspace`;
if (existing && existing.name !== "Posted Preview")
  throw new Error("This is not the disposable preview installation");
if (!existing) {
  const result = await app.request("/api/auth/setup", {
    method: "POST",
    headers: {
      Origin: settings.POSTED_WEB_URL,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      setupSecret: installationSetupSecret(),
      workspaceName: "Posted Preview",
      name: "Alex Morgan",
      email: previewAdminEmail,
      password: crypto.randomUUID(),
    }),
  });
  if (!result.ok)
    throw new Error("Preview installation could not be initialized");
}
const [team] = await sql<{ id: string }[]>`SELECT id FROM workspace`;
const [user] = await sql<
  { id: string; passwordHash: string; role: string }[]
>`SELECT id,password_hash,role FROM users WHERE email=${previewAdminEmail} AND workspace_id=${team.id}`;
if (!user || user.role !== "admin")
  throw new Error("This is not the disposable preview installation");
// Keep the normal setup policy; assign the disposable password only inside this fixture.
if (!(await verifyPassword(previewAdminPassword, user.passwordHash))) {
  const passwordHash = await hashPassword(previewAdminPassword);
  await sql.begin(async (tx) => {
    await tx`UPDATE users SET password_hash=${passwordHash},security_epoch=security_epoch+1,updated_at=now() WHERE id=${user.id}`;
    await tx`DELETE FROM sessions WHERE user_id=${user.id}`;
  });
}
for (const provider of PROVIDERS) {
  const id = crypto.randomUUID();
  await sql`INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,encrypted_credentials,connected_by) VALUES(${id},${team.id},${provider},${`preview-${provider}`},'Alex Morgan',${provider === "bluesky" ? "alex.example.test" : "alexmorgan"},${seal({ accessToken: "disposable-preview-not-a-provider-token", expiresAt: Date.now() + 3_600_000, issuedAt: Date.now() }, `social-connection:${id}`)},${user.id}) ON CONFLICT(workspace_id,provider,account_id) DO NOTHING`;
}
// Unmatchable hashes make these display-only fixtures, never usable credentials.
for (const fixture of [
  { name: "Preview script", owner: user.id, type: "api-key" },
  { name: "Preview team automation", owner: null, type: "api-key" },
  { name: "Codex", owner: user.id, type: "oauth" },
] as const) {
  const hash = `unusable-preview-${fixture.type}-${fixture.owner ?? "team"}`;
  const oauth = fixture.type === "oauth";
  await sql`INSERT INTO credentials(user_id,created_by,access_level,include_admin,name,token_hash,token_prefix,scopes,token_type,oauth_client_id,resource,expires_at)
    VALUES(${fixture.owner},${user.id},'edit',true,${fixture.name},${hash},'posted_preview',${oauth ? ["read", "write", "admin"] : []},${fixture.type},${oauth ? "posted-preview-codex" : null},${oauth ? `${settings.POSTED_API_URL}/mcp` : null},now()+interval '30 days')
    ON CONFLICT(token_hash) DO NOTHING`;
}
console.log(
  "Disposable preview ready: local@avgeek.ltd. Use the fixture password in this script. Do not run the delivery worker with preview connections.",
);
await sql.end();
