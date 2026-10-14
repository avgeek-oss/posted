import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import postgres from "postgres";
import {
  S3Client,
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
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
  POSTED_WEB_URL: "http://localhost:4392",
  POSTED_API_URL: "http://localhost:4391",
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
Object.assign(process.env, environment);
const { app } = await import("../apps/api/src/app.js");
const { sql } = await import("../packages/database/src/index.js");
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
const mediaId = randomUUID();
const image = await readFile("apps/web/public/brand/posted-mark.png");
const key = `posted/originals/${mediaId}/posted.png`;
await storage.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: image,
    ContentType: "image/png",
  }),
);
await sql`INSERT INTO post_media(id,workspace_id,created_by,object_key,file_name,content_type,size_bytes,width,height,state,alt) VALUES(${mediaId},(SELECT id FROM workspace),(SELECT id FROM users LIMIT 1),${key},'posted.png','image/png',${image.length},256,256,'ready','Posted blue postbox logo')`;
const text =
  "Meet Posted. Write a shared message, tailor it for each account and schedule it for a time that works for your team.";
const composer = await calls("/posts", {
  text,
  connectionIds: accounts.map((account) => account.id),
  mediaIds: [mediaId],
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
await calls("/drafts/" + randomUUID(), {
  text: "Our next product update",
  textOverrides: {},
  connectionIds: [accounts[0].id],
  mediaIds: [],
  version: 0,
  idempotencyKey: randomUUID(),
});
await calls("/drafts/" + randomUUID(), {
  text: "Three things we learned this week",
  textOverrides: {},
  connectionIds: [],
  mediaIds: [],
  version: 0,
  idempotencyKey: randomUUID(),
});
await writeFile(
  "tmp/docs-preview.json",
  JSON.stringify(
    {
      ui: environment.POSTED_WEB_URL,
      api: environment.POSTED_API_URL,
      composerId: composer.post.id,
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
console.log("Posted isolated documentation preview: http://localhost:4392");
