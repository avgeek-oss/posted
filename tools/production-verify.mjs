import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const architecture =
  process.env.POSTED_VERIFY_EXPECT_ARCH ??
  (process.arch === "arm64" ? "arm64" : "amd64");
assert(["amd64", "arm64"].includes(architecture));
const imageMode = process.argv.includes("--images");
const sourceCommit =
  process.env.RELEASE_COMMIT ?? process.env.GITHUB_SHA ?? "development";
const images = Object.fromEntries(
  ["api", "worker", "web"].map((component) => [
    component,
    imageMode
      ? process.env[`POSTED_VERIFY_${component.toUpperCase()}_IMAGE`]
      : `posted-${component}:verification-${version}`,
  ]),
);
for (const image of Object.values(images)) assert(image);
const output = resolve("tmp/verification");
await mkdir(output, { recursive: true });
const docker = (...args) =>
  execFileSync("docker", args, { maxBuffer: 128 * 1024 * 1024 })
    .toString()
    .trim();
if (!imageMode)
  for (const component of ["api", "worker", "web"]) {
    console.log(`Building ${component} for linux/${architecture}`);
    execFileSync(
      "docker",
      [
        "build",
        "--platform",
        `linux/${architecture}`,
        "--target",
        component,
        "--build-arg",
        `RELEASE_VERSION=${version}`,
        "--build-arg",
        `SOURCE_COMMIT=${sourceCommit}`,
        "-t",
        images[component],
        ".",
      ],
      { stdio: "inherit" },
    );
  }
for (const image of Object.values(images)) {
  if (imageMode) docker("pull", "--platform", `linux/${architecture}`, image);
  const inspected = JSON.parse(
    docker("image", "inspect", image, "--format", "{{json .}}"),
  );
  assert.equal(inspected.Architecture, architecture);
  assert.equal(
    inspected.Config.Labels["org.opencontainers.image.version"],
    version,
  );
  assert.equal(
    inspected.Config.Labels["org.opencontainers.image.revision"],
    sourceCommit,
  );
}
const suffix = randomBytes(6).toString("hex");
const names = Object.fromEntries(
  [
    "network",
    "postgres",
    "storage",
    "mail",
    "api",
    "web",
    "worker",
    "proxy",
    "restored",
  ].map((key) => [key, `posted-verify-${key}-${suffix}`]),
);
const resources = [];
const envPath = `/tmp/posted-verify-${suffix}.env`;
const secret = randomBytes(48).toString("hex");
const password = randomBytes(24).toString("hex");
const bucket = `posted-verify-${suffix}`;
const webOrigin = "http://localhost:4382";
const apiOrigin = "http://localhost:4381";
const result = {
  version,
  architecture,
  sourceCommit,
  images,
  checks: [],
  externalPublications: 0,
};
const runtime = [
  "--read-only",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  "--pids-limit=256",
];
function run(name, args) {
  docker("run", "-d", "--name", name, ...args);
  resources.push(name);
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(callback, label) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (await callback()) return;
    await pause(1000);
  }
  throw new Error(`Timed out: ${label}`);
}
async function ready(name, port) {
  await eventually(async () => {
    try {
      return (
        await fetch(`http://127.0.0.1:${port}/health/ready`, {
          signal: AbortSignal.timeout(2000),
        })
      ).ok;
    } catch {
      return false;
    }
  }, name);
  const info = JSON.parse(docker("inspect", name))[0];
  assert.equal(docker("exec", name, "id", "-u"), "1000");
  assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert(info.HostConfig.CapDrop.includes("ALL"));
}
const db = (query) =>
  docker(
    "exec",
    names.postgres,
    "psql",
    "-U",
    "posted",
    "-d",
    "posted",
    "-At",
    "-c",
    query,
  );
async function configuration(database = "posted", storageBucket = bucket) {
  await writeFile(
    envPath,
    [
      `DATABASE_URL=postgres://posted:${password}@${names.postgres}:5432/${database}`,
      `POSTED_SECRET=${secret}`,
      `POSTED_API_URL=${apiOrigin}`,
      `POSTED_WEB_URL=${webOrigin}`,
      "POSTED_S3_ENDPOINT=http://127.0.0.1:4384",
      "POSTED_S3_REGION=us-east-1",
      `POSTED_S3_BUCKET=${storageBucket}`,
      `POSTED_S3_ACCESS_KEY_ID=posted-local-fixture`,
      `POSTED_S3_SECRET_ACCESS_KEY=posted-disposable-storage-passphrase`,
      "POSTED_SMTP_HOST=127.0.0.1",
      "POSTED_SMTP_PORT=1025",
      "POSTED_SMTP_FROM=Posted <posted@example.test>",
    ].join("\n"),
    { mode: 0o600 },
  );
}
function apiContainer(name) {
  run(name, [
    ...runtime,
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=32m,mode=1777",
    "--network",
    names.network,
    "-p",
    "127.0.0.1:4381:4341",
    "-p",
    "127.0.0.1:4383:4343",
    "--env-file",
    envPath,
    images.api,
  ]);
}
function proxy(apiName) {
  run(names.proxy, [
    ...runtime,
    "--network",
    `container:${apiName}`,
    "--entrypoint",
    "node",
    images.api,
    "--input-type=module",
    "-e",
    `import net from 'node:net'; for(const [port,host,target] of [[4384,${JSON.stringify(names.storage)},9000],[1025,${JSON.stringify(names.mail)},1025]])net.createServer(socket=>{const upstream=net.connect(target,host);socket.pipe(upstream).pipe(socket);socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());}).listen(port,'127.0.0.1');`,
  ]);
}
let cookie;
const request = (path, body, method) =>
  fetch(`http://127.0.0.1:4381/api${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      Origin: webOrigin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
try {
  docker("network", "create", names.network);
  run(names.postgres, [
    "--network",
    names.network,
    "--tmpfs",
    "/var/lib/postgresql/data:rw,size=256m",
    "-e",
    "POSTGRES_DB=posted",
    "-e",
    "POSTGRES_USER=posted",
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24",
  ]);
  run(names.storage, [
    "--network",
    names.network,
    "--tmpfs",
    "/data:rw,uid=10001,gid=10001",
    "--tmpfs",
    "/logs:rw,uid=10001,gid=10001",
    "-e",
    "RUSTFS_ACCESS_KEY=posted-local-fixture",
    "-e",
    "RUSTFS_SECRET_KEY=posted-disposable-storage-passphrase",
    "-e",
    "RUSTFS_CONSOLE_ENABLE=false",
    "-p",
    "127.0.0.1:4384:9000",
    "rustfs/rustfs@sha256:1803faef57627e2d9c2e7d89d655d712ddded5389040054987163043fecb6a3c",
    "/data",
  ]);
  run(names.mail, [
    "--network",
    names.network,
    "-p",
    "127.0.0.1:4385:8025",
    "axllent/mailpit:v1.27.8@sha256:6abc8e633df15eaf785cfcf38bae48e66f64beecdc03121e249d0f9ec15f0707",
  ]);
  await eventually(async () => {
    try {
      return docker(
        "exec",
        names.postgres,
        "pg_isready",
        "-U",
        "posted",
        "-d",
        "posted",
      ).includes("accepting connections");
    } catch {
      return false;
    }
  }, "PostgreSQL");
  await eventually(async () => {
    try {
      return (
        await fetch("http://127.0.0.1:4384/health", {
          signal: AbortSignal.timeout(2000),
        })
      ).ok;
    } catch {
      return false;
    }
  }, "Private storage");
  await configuration();
  apiContainer(names.api);
  await ready(names.api, 4381);
  proxy(names.api);
  run(names.web, [
    ...runtime,
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=32m",
    "-p",
    "127.0.0.1:4382:4342",
    "-e",
    `POSTED_API_URL=${apiOrigin}`,
    "-e",
    "POSTED_S3_ENDPOINT=http://127.0.0.1:4384",
    images.web,
  ]);
  await ready(names.web, 4382);
  for (const path of [
    "/posts/new",
    "/posts/drafts",
    "/posts/scheduled",
    "/posts/history",
    "/settings/profile",
  ]) {
    const response = await fetch(`http://127.0.0.1:4382${path}`);
    assert.equal(response.status, 200);
    assert(response.headers.get("content-security-policy"));
  }
  result.checks.push("three version-matched images and protected deep routes");
  const preflight = await fetch("http://127.0.0.1:4381/api/auth/session", {
    method: "OPTIONS",
    headers: { Origin: webOrigin, "Access-Control-Request-Method": "GET" },
  });
  assert.equal(preflight.headers.get("access-control-allow-origin"), webOrigin);
  assert.equal(
    (await fetch("http://127.0.0.1:4381/api/preview/social/authorization"))
      .status,
    404,
  );
  const setupBody = {
    setupSecret: createHmac("sha256", secret)
      .update("posted:installation-setup:v1")
      .digest("base64url"),
    workspaceName: "Disposable release verification",
    name: "Reviewer",
    email: "review@example.test",
    password: "Release verification passphrase 42!",
  };
  const denied = await request("/auth/setup", {
    ...setupBody,
    setupSecret: "invalid",
  });
  assert.equal(denied.status, 403);
  const setup = await request("/auth/setup", setupBody);
  assert.equal(setup.status, 201);
  cookie = setup.headers.get("set-cookie")?.split(";")[0];
  assert(cookie);
  assert.equal((await setup.json()).user.emailVerified, true);
  assert.equal(db("SELECT count(*) FROM email_outbox"), "0");
  result.checks.push(
    "setup secret, verified first administrator, exact-origin CORS, no fixture endpoints",
  );
  docker(
    "exec",
    names.api,
    "node",
    "--input-type=module",
    "-e",
    "import {S3Client,CreateBucketCommand} from '@aws-sdk/client-s3'; const client=new S3Client({endpoint:process.env.POSTED_S3_ENDPOINT,region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.POSTED_S3_ACCESS_KEY_ID,secretAccessKey:process.env.POSTED_S3_SECRET_ACCESS_KEY}});await client.send(new CreateBucketCommand({Bucket:process.env.POSTED_S3_BUCKET}));client.destroy();",
  );
  run(names.worker, [
    ...runtime,
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=256m",
    "--network",
    `container:${names.api}`,
    "--env-file",
    envPath,
    images.worker,
  ]);
  await ready(names.worker, 4383);
  docker(
    "exec",
    names.worker,
    "ffmpeg",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:size=1280x720:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "3.2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-metadata",
    "comment=private-fixture-metadata",
    "/tmp/review.mov",
  );
  const video = execFileSync(
    "docker",
    ["exec", names.worker, "cat", "/tmp/review.mov"],
    { maxBuffer: 104857600 },
  );
  const reservation = await request("/media/uploads", {
    fileName: "review.mov",
    contentType: "video/quicktime",
    sizeBytes: video.length,
    alt: "Disposable video",
  });
  assert.equal(reservation.status, 201);
  const upload = await reservation.json();
  assert.equal(
    (
      await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: upload.headers,
        body: video,
      })
    ).status,
    200,
  );
  const complete = await request(`/media/${upload.mediaId}/complete`, {});
  assert.equal(complete.status, 202);
  let media;
  await eventually(async () => {
    const response = await request(`/media/${upload.mediaId}/status`);
    assert.equal(response.status, 200);
    const status = await response.json();
    if (status.state === "ready") {
      media = status.media;
      return true;
    }
    return false;
  }, "Video preparation");
  assert.equal(media.contentType, "video/mp4");
  assert(media.durationSeconds >= 3);
  assert(media.height <= 720);
  const preview = await request(`/media/${media.id}/preview`);
  assert.equal(preview.status, 200);
  const privateUrl = (await preview.json()).url;
  assert.equal((await fetch(privateUrl)).status, 200);
  const anonymous = new URL(privateUrl);
  anonymous.search = "";
  assert([403, 404].includes((await fetch(anonymous)).status));
  result.checks.push(
    "private signed media, real FFmpeg normalization and worker readiness",
  );
  docker(
    "exec",
    names.worker,
    "node",
    "--input-type=module",
    "-e",
    "import sharp from 'sharp';const pixels=Buffer.alloc(160*180*3);pixels.fill(255,0,160*90*3);await sharp(pixels,{raw:{width:160,height:180,pageHeight:90,channels:3}}).gif({delay:[200,200],keepDuplicateFrames:true}).toFile('/tmp/review.gif');",
  );
  const gif = execFileSync("docker", [
    "exec",
    names.worker,
    "cat",
    "/tmp/review.gif",
  ]);
  const gifReservation = await request("/media/uploads", {
    fileName: "review.gif",
    contentType: "image/gif",
    sizeBytes: gif.length,
    alt: "Disposable animation",
  });
  assert.equal(gifReservation.status, 201);
  const gifUpload = await gifReservation.json();
  assert.equal(
    (
      await fetch(gifUpload.uploadUrl, {
        method: "PUT",
        headers: gifUpload.headers,
        body: gif,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(`/media/${gifUpload.mediaId}/complete`, {})).status,
    202,
  );
  await eventually(async () => {
    const response = await request(`/media/${gifUpload.mediaId}/status`);
    assert.equal(response.status, 200);
    const state = await response.json();
    if (state.state !== "ready") return false;
    assert.equal(state.media.contentType, "image/gif");
    assert.equal(state.media.height, 90);
    assert.equal(state.media.durationSeconds, 0.4);
    return true;
  }, "GIF preparation");
  const gifUrls = await (
    await request(`/media/${gifUpload.mediaId}/preview`)
  ).json();
  for (const [url, contentType] of [
    [gifUrls.url, "image/gif"],
    [gifUrls.thumbnailUrl, "image/png"],
  ]) {
    assert.equal((await fetch(url)).headers.get("content-type"), contentType);
    const unsigned = new URL(url);
    unsigned.search = "";
    assert([403, 404].includes((await fetch(unsigned)).status));
  }
  docker(
    "exec",
    names.worker,
    "node",
    "--input-type=module",
    "-e",
    "import {readFile} from 'node:fs/promises';import {normalizeVideo} from './dist/apps/api/src/media/video.js';const video=await normalizeVideo(await readFile('/tmp/review.gif'),'gif');if(video.contentType!=='video/mp4'||video.durationSeconds<3)throw Error('GIF video conversion failed');",
  );
  result.checks.push(
    "animated GIF preparation, private still thumbnails and GIF-to-MP4 conversion",
  );
  const connectionId = randomUUID();
  db(
    `INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,encrypted_credentials) VALUES('${connectionId}',(SELECT id FROM workspace),'bluesky','disposable','Example','example.test','unusable-fixture-credentials')`,
  );
  const draftId = randomUUID();
  const draft = await request(`/drafts/${draftId}`, {
    text: "Release verification",
    additionalPosts: [
      {
        text: "Second draft post",
        textOverrides: { [connectionId]: "Second draft override" },
        mediaIds: [media.id],
      },
    ],
    textOverrides: {},
    connectionIds: [connectionId],
    mediaIds: [media.id],
    version: 0,
    idempotencyKey: randomUUID(),
  });
  assert.equal(draft.status, 201);
  assert.equal((await draft.json()).draft.draftedBy.name, "Reviewer");
  const body = {
    text: "Future release verification",
    additionalPosts: [
      {
        text: "Second scheduled post",
        textOverrides: { [connectionId]: "Scheduled reply override" },
        mediaIds: [media.id],
      },
      { text: "Third scheduled post", textOverrides: {}, mediaIds: [] },
    ],
    connectionIds: [connectionId],
    mediaIds: [media.id],
    scheduledAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    idempotencyKey: randomUUID(),
  };
  const post = await request("/posts", body);
  assert.equal(post.status, 201);
  const postId = (await post.json()).post.id;
  assert.equal((await request("/posts", body)).status, 200);
  assert.equal(db("SELECT count(*) FROM post_deliveries"), "3");
  const scheduledSequence = (await (await request(`/posts/${postId}`)).json())
    .post;
  assert.equal(scheduledSequence.additionalPosts.length, 2);
  assert.equal(scheduledSequence.additionalPosts[0].media[0].id, media.id);
  assert.deepEqual(
    scheduledSequence.deliveries.map((delivery) => delivery.postIndex),
    [0, 1, 2],
  );
  assert.deepEqual(await (await request("/posts/counts")).json(), {
    drafts: 1,
    scheduled: 1,
  });
  const invitation = await request("/auth/invitations", {
    email: "invite@example.test",
    role: "member",
  });
  assert.equal(invitation.status, 201);
  await eventually(async () => {
    const response = await fetch("http://127.0.0.1:4385/api/v1/messages");
    return response.ok && (await response.json()).messages_count === 1;
  }, "Branded SMTP invitation");
  const messages = await (
    await fetch("http://127.0.0.1:4385/api/v1/messages")
  ).json();
  assert.equal(messages.messages[0].From.Name, "Posted");
  result.checks.push(
    "ordered multi-post drafts and schedules, per-post media and overrides, retry replay and branded SMTP delivery",
  );
  const restoredBucket = bucket + "-restore";
  docker(
    "exec",
    names.api,
    "node",
    "--input-type=module",
    "-e",
    `import {S3Client,CreateBucketCommand,ListObjectsV2Command,CopyObjectCommand} from '@aws-sdk/client-s3';const client=new S3Client({endpoint:process.env.POSTED_S3_ENDPOINT,region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.POSTED_S3_ACCESS_KEY_ID,secretAccessKey:process.env.POSTED_S3_SECRET_ACCESS_KEY}});await client.send(new CreateBucketCommand({Bucket:${JSON.stringify(restoredBucket)}}));const objects=await client.send(new ListObjectsV2Command({Bucket:process.env.POSTED_S3_BUCKET}));for(const object of objects.Contents??[])await client.send(new CopyObjectCommand({Bucket:${JSON.stringify(restoredBucket)},Key:object.Key,CopySource:process.env.POSTED_S3_BUCKET+'/'+object.Key}));client.destroy();`,
  );
  docker("stop", "--time", "30", names.worker, names.api);
  docker("rm", "-f", names.proxy);
  const dump = execFileSync(
    "docker",
    ["exec", names.postgres, "pg_dump", "-U", "posted", "-d", "posted", "-Fc"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  await writeFile(resolve(output, "disposable-restore.dump"), dump, {
    mode: 0o600,
  });
  docker("exec", names.postgres, "createdb", "-U", "posted", "restored");
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      names.postgres,
      "pg_restore",
      "-U",
      "posted",
      "-d",
      "restored",
    ],
    { input: dump, stdio: ["pipe", "pipe", "pipe"] },
  );
  await configuration("restored", restoredBucket);
  apiContainer(names.restored);
  proxy(names.restored);
  await ready(names.restored, 4381);
  const login = await request("/auth/login", {
    email: setupBody.email,
    password: setupBody.password,
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  const restoredDraft = await request(`/drafts/${draftId}`);
  assert.equal(restoredDraft.status, 200);
  const restoredDraftBody = (await restoredDraft.json()).draft;
  assert.equal(
    restoredDraftBody.additionalPosts[0].textOverrides[connectionId],
    "Second draft override",
  );
  assert.equal(restoredDraftBody.additionalPosts[0].media[0].id, media.id);
  const restoredPost = await request(`/posts/${postId}`);
  assert.equal(restoredPost.status, 200);
  assert.deepEqual((await restoredPost.json()).post, scheduledSequence);
  const restoredPreview = await (
    await request(`/media/${media.id}/preview`)
  ).json();
  assert.equal((await fetch(restoredPreview.url)).status, 200);
  const restoredGif = await (
    await request(`/media/${gifUpload.mediaId}/preview`)
  ).json();
  assert.equal(
    (await fetch(restoredGif.url)).headers.get("content-type"),
    "image/gif",
  );
  assert.equal(
    (await fetch(restoredGif.thumbnailUrl)).headers.get("content-type"),
    "image/png",
  );
  result.checks.push(
    "PostgreSQL restore, stable secret, restored private media and sign-in",
  );
  await writeFile(
    resolve(output, `production-${architecture}.json`),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    `PASS ${result.checks.length} production gates on ${architecture}; no external social publication.`,
  );
} finally {
  const cleanupFailures = [];
  for (const name of [...new Set(resources)].reverse()) {
    try {
      docker("rm", "-f", name);
    } catch (error) {
      if (!String(error.stderr).includes("No such container"))
        cleanupFailures.push(name);
    }
  }
  try {
    docker("network", "rm", names.network);
  } catch {
    cleanupFailures.push(names.network);
  } finally {
    await rm(envPath, { force: true });
    await rm(resolve(output, "disposable-restore.dump"), { force: true });
  }
  if (cleanupFailures.length) {
    console.error(
      `Verification cleanup failed for: ${cleanupFailures.join(", ")}`,
    );
    process.exitCode = 1;
  }
}
