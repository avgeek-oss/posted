import { after, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import {
  sql,
  request,
  setupUser,
  resetDatabase,
  cleanupDatabase,
} from "./support.js";
import {
  mediaBytes,
  preparedMediaUrl,
  storeOriginal,
} from "../apps/api/src/media/storage.js";
import { seal } from "../apps/api/src/social/secrets.js";
import { prepareImage } from "../apps/api/src/media/prepare.js";
import { deliverNext } from "../apps/worker/src/delivery.js";
import { videoFixture } from "./video-fixture.js";
import { gifFixture } from "./gif-fixture.js";
import { gifMetadata } from "../apps/api/src/media/gif.js";
import { prepareNextMedia } from "../apps/worker/src/media.js";
const endpoint =
  process.env.POSTED_TEST_STORAGE_ENDPOINT ?? "http://127.0.0.1:55491";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname))
  throw new Error(
    "Storage integration tests require a disposable loopback service",
  );
process.env.POSTED_S3_ENDPOINT = endpoint;
process.env.POSTED_S3_REGION = "us-east-1";
process.env.POSTED_S3_BUCKET = `posted-test-${randomBytes(8).toString("hex")}`;
process.env.POSTED_S3_ACCESS_KEY_ID = "posted-local-fixture";
process.env.POSTED_S3_SECRET_ACCESS_KEY =
  "posted-disposable-storage-passphrase";
const bucket = process.env.POSTED_S3_BUCKET;
const client = new S3Client({
  endpoint,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.POSTED_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.POSTED_S3_SECRET_ACCESS_KEY,
  },
});
before(async () => {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
});
beforeEach(resetDatabase);
after(async () => {
  const objects = await client.send(
    new ListObjectsV2Command({ Bucket: bucket }),
  );
  if (objects.Contents?.length)
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects.Contents.map((o) => ({ Key: o.Key })) },
      }),
    );
  await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  client.destroy();
  await cleanupDatabase();
});
async function image() {
  return sharp({
    create: { width: 120, height: 80, channels: 3, background: "#368cca" },
  })
    .png()
    .toBuffer();
}
test("scheduled image order is retained and the worker uploads only the first supported images", async () => {
  const admin = await setupUser();
  const connectionId = randomUUID();
  const token = seal(
    {
      accessToken: "disposable-access",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 36e5,
    },
    `social-connection:${connectionId}`,
  );
  await sql`INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,encrypted_credentials) VALUES(${connectionId},(SELECT id FROM workspace),'x','disposable-account','Account','example',${token})`;
  const ids: string[] = [];
  const expected: string[] = [];
  for (const background of [
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#ffff00",
    "#00ffff",
    "#ff00ff",
  ]) {
    const id = randomUUID();
    const key = `ordered/${id}.png`;
    const bytes = await sharp({
      create: { width: 120, height: 80, channels: 3, background },
    })
      .png()
      .toBuffer();
    await storeOriginal(key, bytes, "image/png");
    await sql`INSERT INTO post_media(id,workspace_id,created_by,object_key,file_name,content_type,size_bytes,width,height,state) VALUES(${id},(SELECT id FROM workspace),${admin.user.id},${key},'image.png','image/png',${bytes.length},120,80,'ready')`;
    ids.push(id);
    expected.push((await prepareImage(bytes, "x")).bytes.toString("base64"));
  }
  const priority = [ids[5], ids[0], ids[3], ids[2], ids[1], ids[4]];
  const body = {
    text: "Ordered fixture images",
    connectionIds: [connectionId],
    mediaIds: priority,
    scheduledAt: new Date().toISOString(),
    idempotencyKey: randomUUID(),
  };
  const response = await request("/api/posts", { cookie: admin.cookie, body });
  assert.equal(response.status, 201);
  const { post } = await response.json();
  assert.deepEqual(
    post.media.map((item: { id: string }) => item.id),
    priority,
  );
  assert.equal(
    (
      await request("/api/posts", {
        cookie: admin.cookie,
        body: { ...body, mediaIds: ids },
      })
    ).status,
    409,
  );
  const uploaded: string[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, "https://api.x.com");
      if (url.pathname === "/2/media/upload") {
        uploaded.push(JSON.parse(String(init?.body)).media);
        return Response.json({ data: { id: `media-${uploaded.length}` } });
      }
      assert.equal(url.pathname, "/2/tweets");
      assert.deepEqual(JSON.parse(String(init?.body)).media.media_ids, [
        "media-1",
        "media-2",
        "media-3",
        "media-4",
      ]);
      return Response.json({ data: { id: "disposable-post" } });
    },
  );
  try {
    await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
    assert.equal(await deliverNext(), true);
    assert.deepEqual(uploaded, [
      expected[5],
      expected[0],
      expected[3],
      expected[2],
    ]);
    assert.equal(
      (await sql`SELECT state FROM post_deliveries`)[0].state,
      "published",
    );
  } finally {
    mock.restoreAll();
  }
});
async function begin(
  cookie: string,
  bytes: Uint8Array,
  overrides: Record<string, unknown> = {},
) {
  const result = await request("/api/media/uploads", {
    cookie,
    body: {
      fileName: "team-image.png",
      contentType: "image/png",
      sizeBytes: bytes.length,
      alt: "Blue test image",
      ...overrides,
    },
  });
  assert.equal(result.status, 201);
  const body = await result.json();
  const uploaded = await fetch(body.uploadUrl, {
    method: "PUT",
    headers: body.headers,
    body: Buffer.from(bytes),
  });
  assert.equal(uploaded.status, 200);
  return body;
}
test("signed uploads complete into private immutable originals and support team preview", async () => {
  const admin = await setupUser();
  const bytes = await image();
  const upload = await begin(admin.cookie, bytes);
  const completed = await request(`/api/media/${upload.mediaId}/complete`, {
    cookie: admin.cookie,
    body: {},
  });
  assert.equal(completed.status, 200);
  const saved = (await completed.json()).media;
  assert.equal(saved.width, 120);
  assert.equal(saved.height, 80);
  assert.equal(saved.alt, "Blue test image");
  const [row] =
    await sql`SELECT object_key,state FROM post_media WHERE id=${upload.mediaId}`;
  assert.match(row.objectKey, /^posted\/originals\//);
  assert.equal(row.state, "ready");
  const unsigned = `${endpoint}/${bucket}/${row.objectKey}`;
  assert.equal((await fetch(unsigned)).status, 403);
  assert.equal(
    (await request(`/api/media/${upload.mediaId}/preview`)).status,
    401,
  );
  const preview = await request(`/api/media/${upload.mediaId}/preview`, {
    cookie: admin.cookie,
  });
  assert.equal(preview.status, 200);
  const signedUrl = (await preview.json()).url;
  const downloaded = await fetch(signedUrl);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  const replacement = Buffer.alloc(bytes.length, 1);
  assert.equal(
    (
      await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: upload.headers,
        body: replacement,
      })
    ).status,
    200,
  );
  assert.deepEqual(
    await mediaBytes(row.objectKey),
    bytes,
    "replaying the temporary PUT never changes the original",
  );
  await assert.rejects(storeOriginal(row.objectKey, replacement, "image/png"));
  assert.equal(
    (
      await request(`/api/media/${upload.mediaId}/complete`, {
        cookie: admin.cookie,
        body: {},
      })
    ).status,
    200,
  );
});
test("completion verifies exact file bytes and viewers cannot upload", async () => {
  const admin = await setupUser();
  const bytes = await image();
  const wrongType = await begin(admin.cookie, bytes, {
    contentType: "image/jpeg",
  });
  assert.equal(
    (
      await request(`/api/media/${wrongType.mediaId}/complete`, {
        cookie: admin.cookie,
        body: {},
      })
    ).status,
    400,
  );
  assert.equal(
    (await sql`SELECT state FROM post_media WHERE id=${wrongType.mediaId}`)[0]
      .state,
    "uploading",
  );
  await sql`UPDATE users SET role='viewer' WHERE id=${admin.user.id}`;
  assert.equal(
    (
      await request("/api/media/uploads", {
        cookie: admin.cookie,
        body: {
          fileName: "test.png",
          contentType: "image/png",
          sizeBytes: bytes.length,
        },
      })
    ).status,
    403,
  );
});
test("delivery images get expiring signed fetch URLs and bounded reads reject excess bytes", async () => {
  const bytes = await image();
  const url = await preparedMediaUrl(
    "posted/delivery/fixture.jpg",
    await sharp(bytes).jpeg().toBuffer(),
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("X-Amz-Expires"), "3600");
  const result = await fetch(url);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("content-type"), "image/jpeg");
  assert.equal(
    (await sharp(Buffer.from(await result.arrayBuffer())).metadata()).format,
    "jpeg",
  );
  await assert.rejects(mediaBytes("posted/delivery/fixture.jpg", 10));
});
test("video uploads prepare asynchronously under a single lease and remain private before and after processing", async () => {
  const admin = await setupUser();
  const source = await videoFixture("mov");
  const upload = await begin(admin.cookie, source, {
    fileName: "team-video.mov",
    contentType: "video/quicktime",
  });
  const completed = await request(`/api/media/${upload.mediaId}/complete`, {
    cookie: admin.cookie,
    body: {},
  });
  assert.equal(completed.status, 202);
  assert.equal((await completed.json()).state, "processing");
  assert.equal(
    (
      await request(`/api/media/${upload.mediaId}/preview`, {
        cookie: admin.cookie,
      })
    ).status,
    404,
  );
  const results = await Promise.all([prepareNextMedia(), prepareNextMedia()]);
  assert.deepEqual(results.sort(), [false, true]);
  const ready = await request(`/api/media/${upload.mediaId}/status`, {
    cookie: admin.cookie,
  });
  const { state, media } = await ready.json();
  assert.equal(state, "ready");
  assert.equal(media.contentType, "video/mp4");
  assert.ok(media.durationSeconds >= 3);
  const [row] =
    await sql`SELECT original_object_key,object_key FROM post_media WHERE id=${upload.mediaId}`;
  assert.notEqual(row.objectKey, row.originalObjectKey);
  assert.deepEqual(await mediaBytes(row.originalObjectKey), source);
  assert.equal(
    (await fetch(`${endpoint}/${bucket}/${row.objectKey}`)).status,
    403,
  );
  const preview = await request(`/api/media/${upload.mediaId}/preview`, {
    cookie: admin.cookie,
  });
  const response = await fetch((await preview.json()).url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  const [account] =
    await sql`INSERT INTO social_connections(workspace_id,provider,account_id,name,handle,encrypted_credentials) VALUES((SELECT id FROM workspace),'x','fixture','Example','example','unusable') RETURNING id`;
  const body = {
    text: "",
    mediaIds: [media.id],
    connectionIds: [account.id],
    scheduledAt: new Date(Date.now() + 36e5).toISOString(),
    idempotencyKey: randomUUID(),
  };
  assert.equal(
    (await request("/api/posts", { cookie: admin.cookie, body })).status,
    201,
  );
  await sql`UPDATE post_media SET duration_seconds=141 WHERE id=${media.id}`;
  assert.equal(
    (
      await request("/api/posts", {
        cookie: admin.cookie,
        body: { ...body, idempotencyKey: randomUUID() },
      })
    ).status,
    400,
  );
  assert.equal(
    (await sql`SELECT count(*)::int AS count FROM post_groups`)[0].count,
    1,
  );
});

test("a malformed video cannot become ready or be scheduled", async () => {
  const admin = await setupUser();
  const bytes = (await videoFixture()).subarray(0, 32);
  const upload = await begin(admin.cookie, bytes, {
    contentType: "video/mp4",
    fileName: "broken.mp4",
  });
  assert.equal(
    (
      await request(`/api/media/${upload.mediaId}/complete`, {
        cookie: admin.cookie,
        body: {},
      })
    ).status,
    202,
  );
  assert.equal(await prepareNextMedia(), true);
  assert.equal(
    (
      await request(`/api/media/${upload.mediaId}/status`, {
        cookie: admin.cookie,
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request(`/api/media/${upload.mediaId}/preview`, {
        cookie: admin.cookie,
      })
    ).status,
    404,
  );
  const [record] =
    await sql`SELECT state,duration_seconds FROM post_media WHERE id=${upload.mediaId}`;
  assert.equal(record.state, "failed");
  assert.equal(record.durationSeconds, null);
  await sql`UPDATE users SET role='viewer' WHERE id=${admin.user.id}`;
  assert.equal(
    (
      await request("/api/media/uploads", {
        cookie: admin.cookie,
        body: {
          fileName: "video.mp4",
          contentType: "video/mp4",
          sizeBytes: 100,
          alt: "",
        },
      })
    ).status,
    403,
  );
});

test("worker delivers account-specific image order, explicit empty media and inherited reply media", async () => {
  const admin = await setupUser();
  const connectionId = randomUUID();
  const token = seal(
    {
      accessToken: "disposable",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 36e5,
    },
    `social-connection:${connectionId}`,
  );
  await sql`INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,encrypted_credentials) VALUES(${connectionId},(SELECT id FROM workspace),'x','account-media-fixture','Fixture','fixture',${token})`;
  const ids: string[] = [];
  const expected: string[] = [];
  for (const background of ["#ff0000", "#00ff00", "#0000ff"]) {
    const id = randomUUID();
    const key = `account-variants/${id}.png`;
    const bytes = await sharp({
      create: { width: 120, height: 80, channels: 3, background },
    })
      .png()
      .toBuffer();
    await storeOriginal(key, bytes, "image/png");
    await sql`INSERT INTO post_media(id,workspace_id,object_key,file_name,content_type,size_bytes,width,height,state) VALUES(${id},(SELECT id FROM workspace),${key},'variant.png','image/png',${bytes.length},120,80,'ready')`;
    ids.push(id);
    expected.push((await prepareImage(bytes, "x")).bytes.toString("base64"));
  }
  const response = await request("/api/posts", {
    cookie: admin.cookie,
    body: {
      text: "Custom selection",
      connectionIds: [connectionId],
      mediaIds: [ids[0]],
      mediaOverrides: { [connectionId]: [ids[2], ids[1]] },
      additionalPosts: [
        {
          text: "No media for this reply",
          mediaIds: [ids[0]],
          mediaOverrides: { [connectionId]: [] },
        },
        { text: "Inherited media", mediaIds: [ids[0]] },
      ],
      scheduledAt: new Date().toISOString(),
      idempotencyKey: randomUUID(),
    },
  });
  assert.equal(response.status, 201);
  const uploaded: string[] = [];
  const tweets: Record<string, unknown>[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (target: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        target instanceof Request ? target.url : String(target),
      );
      assert.equal(url.origin, "https://api.x.com");
      const body = JSON.parse(String(init?.body));
      if (url.pathname === "/2/media/upload") {
        uploaded.push(body.media);
        return Response.json({ data: { id: `variant-${uploaded.length}` } });
      }
      assert.equal(url.pathname, "/2/tweets");
      tweets.push(body);
      return Response.json({ data: { id: `post-${tweets.length}` } });
    },
  );
  try {
    await sql`UPDATE post_deliveries SET available_at=now()-interval '1 second'`;
    for (let i = 0; i < 3; i++) assert.equal(await deliverNext(), true);
    assert.equal(await deliverNext(), false);
    assert.deepEqual(uploaded, [expected[2], expected[1], expected[0]]);
    assert.deepEqual(
      tweets.map((tweet) => tweet.media),
      [
        { media_ids: ["variant-1", "variant-2"] },
        undefined,
        { media_ids: ["variant-3"] },
      ],
    );
    assert.ok(
      (await sql`SELECT state FROM post_deliveries`).every(
        (row) => row.state === "published",
      ),
    );
  } finally {
    mock.restoreAll();
  }
});

test("GIF uploads keep private originals, prepare once, and publish animation through X, LinkedIn and LinkedIn Pages", async () => {
  const admin = await setupUser();
  const source = await gifFixture();
  const upload = await begin(admin.cookie, source, {
    fileName: "animation.gif",
    contentType: "image/gif",
  });
  assert.equal(
    (
      await request(`/api/media/${upload.mediaId}/complete`, {
        cookie: admin.cookie,
        body: {},
      })
    ).status,
    202,
  );
  assert.deepEqual(
    (await Promise.all([prepareNextMedia(), prepareNextMedia()])).sort(),
    [false, true],
  );
  const status = await request(`/api/media/${upload.mediaId}/status`, {
    cookie: admin.cookie,
  });
  const { media, state } = await status.json();
  assert.equal(state, "ready");
  assert.equal(media.contentType, "image/gif");
  assert.equal(media.width, 160);
  assert.equal(media.height, 90);
  assert.equal(media.durationSeconds, 0.8);
  const [stored] =
    await sql`SELECT original_object_key,object_key,thumbnail_object_key FROM post_media WHERE id=${media.id}`;
  assert.deepEqual(await mediaBytes(stored.originalObjectKey), source);
  assert.notEqual(stored.originalObjectKey, stored.objectKey);
  for (const key of [
    stored.originalObjectKey,
    stored.objectKey,
    stored.thumbnailObjectKey,
  ])
    assert.equal((await fetch(`${endpoint}/${bucket}/${key}`)).status, 403);
  assert.equal((await request(`/api/media/${media.id}/preview`)).status, 401);
  const preview = await request(`/api/media/${media.id}/preview`, {
    cookie: admin.cookie,
  });
  const urls = await preview.json();
  assert.equal(
    (await fetch(urls.url)).headers.get("content-type"),
    "image/gif",
  );
  assert.equal(
    (await fetch(urls.thumbnailUrl)).headers.get("content-type"),
    "image/png",
  );
  const accounts: string[] = [];
  for (const provider of ["x", "linkedin", "linkedin-pages"]) {
    const id = randomUUID();
    const credentials = seal(
      {
        accessToken: "disposable-access",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 36e5,
      },
      `social-connection:${id}`,
    );
    await sql`INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,encrypted_credentials) VALUES(${id},(SELECT id FROM workspace),${provider},'fixture','Example','example',${credentials})`;
    accounts.push(id);
  }
  const input = {
    text: "GIF fixture",
    mediaIds: [media.id],
    connectionIds: accounts,
    scheduledAt: new Date().toISOString(),
    idempotencyKey: randomUUID(),
  };
  const stillUpload = await begin(admin.cookie, await image());
  await request(`/api/media/${stillUpload.mediaId}/complete`, {
    cookie: admin.cookie,
    body: {},
  });
  assert.equal(
    (await request("/api/posts", { cookie: admin.cookie, body: input })).status,
    201,
  );
  assert.equal(
    (
      await request("/api/posts", {
        cookie: admin.cookie,
        body: {
          ...input,
          mediaIds: [media.id, stillUpload.mediaId],
          idempotencyKey: randomUUID(),
        },
      })
    ).status,
    400,
  );
  let xUploaded = false;
  let linkedInUploaded = false;
  let published = 0;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/2/media/upload/initialize") {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.media_type, "image/gif");
        assert.equal(body.media_category, "tweet_gif");
        return Response.json({ data: { id: "gif-media" } });
      }
      if (url.pathname.endsWith("/append")) {
        const body = JSON.parse(String(init?.body));
        const bytes = Buffer.from(body.media, "base64");
        assert.equal((await gifMetadata(bytes)).frames, 4);
        assert.equal(bytes.includes(Buffer.from("private-gif-fixture")), false);
        xUploaded = true;
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith("/finalize"))
        return Response.json({ data: {} });
      if (url.pathname === "/2/tweets") {
        assert.equal(xUploaded, true);
        published++;
        return Response.json({ data: { id: "gif-tweet" } });
      }
      if (url.pathname === "/rest/images")
        return Response.json({
          value: {
            image: "urn:li:image:gif",
            uploadUrl: "https://media.licdn.com/gif-upload",
          },
        });
      if (url.hostname === "media.licdn.com") {
        assert.equal(
          new Headers(init?.headers).get("content-type"),
          "image/gif",
        );
        assert.ok(init?.body instanceof Uint8Array);
        assert.equal((await gifMetadata(init.body)).frames, 4);
        linkedInUploaded = true;
        return new Response(null, { status: 201 });
      }
      assert.equal(url.pathname, "/rest/posts");
      assert.equal(linkedInUploaded, true);
      published++;
      return new Response(null, {
        status: 201,
        headers: { "x-restli-id": "urn:li:share:gif" },
      });
    },
  );
  try {
    assert.equal(await deliverNext(), true);
    assert.equal(await deliverNext(), true);
    assert.equal(await deliverNext(), true);
    assert.equal(published, 3);
    assert.deepEqual(
      (await sql`SELECT state FROM post_deliveries`).map((d) => d.state),
      ["published", "published", "published"],
    );
  } finally {
    mock.restoreAll();
  }
});

test("Threads GIF delivery uses a private signed MP4 and only publishes after processing", async () => {
  const admin = await setupUser();
  const upload = await begin(admin.cookie, await gifFixture(), {
    fileName: "animation.gif",
    contentType: "image/gif",
  });
  await request(`/api/media/${upload.mediaId}/complete`, {
    cookie: admin.cookie,
    body: {},
  });
  await prepareNextMedia();
  const id = randomUUID();
  const credentials = seal(
    {
      accessToken: "disposable-access",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 36e5,
    },
    `social-connection:${id}`,
  );
  await sql`INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,encrypted_credentials) VALUES(${id},(SELECT id FROM workspace),'threads','fixture','Example','example',${credentials})`;
  assert.equal(
    (
      await request("/api/posts", {
        cookie: admin.cookie,
        body: {
          text: "GIF as video",
          mediaIds: [upload.mediaId],
          connectionIds: [id],
          scheduledAt: new Date().toISOString(),
          idempotencyKey: randomUUID(),
        },
      })
    ).status,
    201,
  );
  const actualFetch = globalThis.fetch;
  let prepared = false;
  let published = false;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "127.0.0.1") return actualFetch(input, init);
      assert.equal(url.hostname, "graph.threads.net");
      if (url.pathname.endsWith("/threads")) {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("media_type"), "VIDEO");
        const videoUrl = body.get("video_url");
        assert.ok(videoUrl);
        const signed = new URL(videoUrl);
        assert.ok(signed.searchParams.has("X-Amz-Signature"));
        const response = await actualFetch(signed);
        assert.equal(response.headers.get("content-type"), "video/mp4");
        assert.ok((await response.arrayBuffer()).byteLength > 100);
        signed.search = "";
        assert.equal((await actualFetch(signed)).status, 403);
        return Response.json({ id: "gif-container" });
      }
      if (url.searchParams.get("fields") === "id,status") {
        prepared = true;
        return Response.json({ status: "FINISHED" });
      }
      if (url.pathname.endsWith("/threads_publish")) {
        assert.equal(prepared, true);
        published = true;
        return Response.json({ id: "gif-post" });
      }
      return Response.json({
        permalink: "https://www.threads.net/@example/post/gif-post",
      });
    },
  );
  try {
    assert.equal(await deliverNext(), true);
    assert.equal(published, true);
    assert.equal(
      (await sql`SELECT state FROM post_deliveries`)[0].state,
      "published",
    );
  } finally {
    mock.restoreAll();
  }
});
