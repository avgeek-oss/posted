import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import postgres from "postgres";
import {
  S3Client,
  CreateBucketCommand,
  PutBucketCorsCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} from "@aws-sdk/client-s3";
const databaseUrl = process.env.DATABASE_URL;
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)
)
  throw new Error(
    "Documentation fixtures require a disposable loopback database",
  );
const schema = `docs_${randomBytes(8).toString("hex")}`;
const bucket = `posted-docs-${randomBytes(8).toString("hex")}`;
const environment = {
  ...process.env,
  NODE_ENV: "development",
  POSTED_DB_SCHEMA: schema,
  PORT: "4391",
  POSTED_WEB_URL: "http://127.0.0.1:4392",
  POSTED_API_URL: "http://127.0.0.1:4391",
  POSTED_SECRET: randomBytes(48).toString("hex"),
  POSTED_S3_ENDPOINT: "http://127.0.0.1:55491",
  POSTED_S3_REGION: "us-east-1",
  POSTED_S3_BUCKET: bucket,
  POSTED_S3_ACCESS_KEY_ID: "posted-local-fixture",
  POSTED_S3_SECRET_ACCESS_KEY: "posted-disposable-storage-passphrase",
  POSTED_SMTP_HOST: "",
  POSTED_SMTP_FROM: "",
  POSTED_SMTP_USER: "",
  POSTED_SMTP_PASSWORD: "",
  POSTED_X_CLIENT_ID: "",
  POSTED_X_CLIENT_SECRET: "",
  POSTED_LINKEDIN_CLIENT_ID: "",
  POSTED_LINKEDIN_CLIENT_SECRET: "",
  POSTED_FACEBOOK_CLIENT_ID: "",
  POSTED_FACEBOOK_CLIENT_SECRET: "",
  POSTED_FACEBOOK_CONFIG_ID: "",
  POSTED_LINKEDIN_PAGES_CLIENT_ID: "",
  POSTED_LINKEDIN_PAGES_CLIENT_SECRET: "",
  POSTED_THREADS_CLIENT_ID: "",
  POSTED_THREADS_CLIENT_SECRET: "",
  POSTED_BLUESKY_CLIENT_ID: "",
  POSTED_BLUESKY_PRIVATE_KEY_JWK: "",
};
const database = postgres(databaseUrl, { onnotice() {} });
const storage = new S3Client({
  endpoint: environment.POSTED_S3_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: environment.POSTED_S3_ACCESS_KEY_ID,
    secretAccessKey: environment.POSTED_S3_SECRET_ACCESS_KEY,
  },
});
await mkdir("tmp", { recursive: true });
await database.unsafe(`CREATE SCHEMA ${schema}`);
await storage.send(new CreateBucketCommand({ Bucket: bucket }));
await storage.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [environment.POSTED_WEB_URL],
          AllowedMethods: ["GET", "PUT"],
          AllowedHeaders: ["*"],
          ExposeHeaders: ["ETag"],
        },
      ],
    },
  }),
);
execFileSync(process.execPath, ["--import", "tsx", "tools/local-preview.ts"], {
  env: environment,
  stdio: "pipe",
});
execFileSync(
  process.execPath,
  ["--import", "tsx", "tools/local-preview-drafts.ts"],
  {
    env: environment,
    stdio: "pipe",
  },
);
Object.assign(process.env, environment);
const { app } = await import("../apps/api/src/app.js");
const { sql } = await import("../packages/database/src/index.js");
const [administrator] = await sql<{ id: string }[]>`
  SELECT id FROM users WHERE email='local@avgeek.ltd'`;
if (!administrator) throw new Error("Documentation administrator missing");
await sql`DELETE FROM credentials WHERE token_hash LIKE 'unusable-preview-%'`;
for (const sample of [
  { name: "Draft reader", team: false, access: "read" },
  { name: "Personal publishing script", team: false, access: "edit" },
  { name: "Publishing automation", team: true, access: "edit" },
  { name: "Weekly report", team: true, access: "read" },
]) {
  await sql`INSERT INTO credentials(user_id,created_by,name,token_hash,token_prefix,scopes,access_level,expires_at,last_used_at)
    VALUES(${sample.team ? null : administrator.id},${administrator.id},${sample.name},${`documentation-only:${randomUUID()}`},'posted_demo','{}'::text[],${sample.access},now()+interval '90 days',now()-interval '1 hour')`;
}
await sql`INSERT INTO credentials(user_id,created_by,name,token_hash,token_prefix,scopes,token_type,oauth_client_id,resource,expires_at,access_level,last_used_at)
  VALUES(${administrator.id},${administrator.id},'Codex',${`documentation-only:${randomUUID()}`},'posted_demo',ARRAY['read','write'],'oauth','https://chatgpt.com/oauth/codex/client.json',${`${environment.POSTED_API_URL}/mcp`},now()+interval '30 days','edit',now()-interval '10 minutes')`;
const login = await app.request("/api/auth/login", {
  method: "POST",
  headers: {
    Origin: environment.POSTED_WEB_URL,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email: "local@avgeek.ltd", password: "test123" }),
});
if (!login.ok) throw new Error("Docs fixture sign-in failed");
const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
const calls = async (path: string, body: unknown) => {
  const response = await app.request("/api" + path, {
    method: "POST",
    headers: {
      Origin: environment.POSTED_WEB_URL,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`Docs fixture failed: ${path} (${response.status})`);
  return response.json();
};
const accounts = await sql<
  { id: string; provider: string }[]
>`SELECT id,provider FROM social_connections ORDER BY provider`;
const attachments = await sql<
  { id: string; fileName: string }[]
>`SELECT id,file_name FROM post_media WHERE state='ready'`;
const mediaId = (name: string) => {
  const media = attachments.find((item) => item.fileName.includes(name));
  if (!media) throw new Error(`Documentation media missing: ${name}`);
  return media.id;
};
const text =
  "Meet Posted. Write a shared message, tailor it for each account and schedule it for a time that works for your team.";
const composer = await calls("/posts", {
  text,
  connectionIds: accounts.map((account) => account.id),
  mediaIds: [mediaId("landscape")],
  additionalPosts: [
    {
      text: "A closer look at the details: give each account its own voice while keeping one shared master.",
      mediaIds: [mediaId("portrait"), mediaId("square")],
    },
    {
      text: "Finish with a short motion study. What are you making this week?",
      mediaIds: [mediaId("video")],
    },
  ],
  scheduledAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  idempotencyKey: randomUUID(),
});
await calls("/posts", {
  text: "A look behind the scenes: how our team plans the next week of posts.",
  connectionIds: accounts.slice(0, 2).map((account) => account.id),
  mediaIds: [],
  scheduledAt: new Date(Date.now() + 8 * 86400000).toISOString(),
  idempotencyKey: randomUUID(),
});
const history = await calls("/posts", {
  text: "Studio notes: one idea, several audiences. A sample completed publication for the documentation.",
  connectionIds: accounts.map((account) => account.id),
  mediaIds: [mediaId("square")],
  scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  idempotencyKey: randomUUID(),
});
await sql`UPDATE post_groups SET scheduled_at=now() WHERE id=${history.post.id}`;
await sql`UPDATE post_deliveries SET state='published',provider_post_id='documentation-fixture',published_url='https://example.test/sample-post',published_at=now(),updated_at=now() WHERE group_id=${history.post.id}`;
await writeFile(
  "tmp/docs-preview.json",
  JSON.stringify(
    {
      ui: environment.POSTED_WEB_URL,
      api: environment.POSTED_API_URL,
      composerId: composer.post.id,
      historyId: history.post.id,
      schema,
      bucket,
    },
    null,
    2,
  ),
);
const children = [
  spawn(process.execPath, ["--import", "tsx", "tools/local-preview-api.ts"], {
    env: environment,
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    [
      process.cwd() + "/apps/web/node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "4392",
    ],
    { cwd: process.cwd() + "/apps/web", env: environment, stdio: "inherit" },
  ),
];
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => child.once("exit", () => resolve())),
    ),
  );
  const objects = await storage.send(
    new ListObjectsV2Command({ Bucket: bucket }),
  );
  if (objects.Contents?.length)
    await storage.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: objects.Contents.map((object) => ({ Key: object.Key })),
        },
      }),
    );
  await storage.send(new DeleteBucketCommand({ Bucket: bucket }));
  await sql.end();
  await database.unsafe(`DROP SCHEMA ${schema} CASCADE`);
  await database.end();
  storage.destroy();
  await rm("tmp/docs-preview.json", { force: true });
  process.exit(0);
}
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
console.log(
  `Posted isolated documentation preview: ${environment.POSTED_WEB_URL}`,
);
