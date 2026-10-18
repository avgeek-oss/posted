import { after, afterEach, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import http, { type RequestOptions, type IncomingMessage } from "node:http";
import https from "node:https";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { firstPostLink } from "../packages/contracts/src/links.js";
import {
  getLinkPreview,
  linkMetadata,
  publicAddress,
  publicLink,
} from "../apps/api/src/links/preview.js";
import {
  cleanupDatabase,
  request,
  resetDatabase,
  setupUser,
} from "./support.js";
import { preparePublication } from "../apps/api/src/social/publish.js";
import type { DeliveryJob } from "../apps/api/src/posts/queue.js";

let base: string;
let image: Buffer;
const hits: string[] = [];
const server = http.createServer((req, res) => {
  hits.push(req.url!);
  if (req.url === "/image.png") {
    res.setHeader("Content-Type", "image/png");
    res.end(image);
    return;
  }
  if (req.url === "/huge.png") {
    res.setHeader("Content-Type", "image/png");
    res.end(Buffer.alloc(4 * 1024 * 1024 + 1));
    return;
  }
  if (req.url === "/redirect") {
    res.writeHead(302, { Location: "/story" });
    res.end();
    return;
  }
  if (req.url === "/private") {
    res.writeHead(302, { Location: "http://127.0.0.1/secret" });
    res.end();
    return;
  }
  if (req.url === "/loop") {
    res.writeHead(302, { Location: "/loop" });
    res.end();
    return;
  }
  if (req.url === "/slow") return;
  res.setHeader("Content-Type", "text/html");
  const source =
    req.url === "/huge-image"
      ? "/huge.png"
      : req.url === "/private-image"
        ? "http://169.254.169.254/secret"
        : "/image.png";
  if (req.url === "/empty") {
    res.end("<html><body>No metadata</body></html>");
    return;
  }
  if (req.url === "/broken-image") {
    res.end(
      '<title>Readable title</title><meta property="og:image" content="http://[invalid">',
    );
    return;
  }
  res.end(
    `<head><title>Fallback</title><meta property="og:title" content="Field notes &amp; ideas"><meta property="og:description" content="A useful story."><meta property="og:site_name" content="Studio"><meta property="og:image" content="${source}"></head><body>${req.url === "/large-page" ? "x".repeat(600_000) : ""}</body>`,
  );
});
before(async () => {
  image = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: "#2253b8" },
  })
    .png()
    .withMetadata()
    .toBuffer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(() => mock.restoreAll());
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await cleanupDatabase();
});
function transport() {
  mock.method(dns, "lookup", async () => [
    { address: "93.184.216.34", family: 4 },
  ]);
  const realRequest = http.request;
  const requests: string[] = [];
  const proxy = (
    url: URL,
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => {
    requests.push(url.href);
    assert.equal(options.agent, false);
    assert.equal(options.family, 4);
    assert.ok(options.signal);
    assert.deepEqual(Object.keys(options.headers ?? {}).sort(), [
      "Accept",
      "Accept-Encoding",
      "User-Agent",
    ]);
    assert.ok(options.lookup);
    options.lookup("rebound.example", {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, "93.184.216.34");
      assert.equal(family, 4);
    });
    return realRequest(
      new URL(url.pathname + url.search, base),
      { ...options, lookup: undefined },
      callback,
    );
  };
  mock.method(https, "request", proxy);
  mock.method(http, "request", proxy);
  return requests;
}
function link(path: string) {
  return `https://${randomUUID()}.example.com${path}`;
}

test("links extract one complete URL and metadata uses head-only Open Graph with entity decoding", () => {
  assert.equal(
    firstPostLink(
      "Read https://example.com/story?a=1#part and https://other.com",
    ),
    "https://example.com/story?a=1",
  );
  assert.equal(
    firstPostLink("Visit example.com/story."),
    "https://example.com/story",
  );
  assert.equal(firstPostLink("Just text"), null);
  assert.equal(firstPostLink("https://example.com/" + "x".repeat(2048)), null);
  assert.deepEqual(
    linkMetadata(
      '<head><title>Fallback</title><meta property="og:title" content="First &amp; best"><meta property="og:title" content="Second"><meta name="description" content="Useful\n summary"></head><body><meta property="og:image" content="bad"></body>',
    ),
    {
      title: "First & best",
      description: "Useful summary",
      siteName: "",
      image: undefined,
    },
  );
});
test("private, reserved, mapped and unusual network destinations are rejected", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "192.0.2.1",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "64:ff9b::a00:1",
  ])
    assert.equal(publicAddress(address), false, address);
  for (const address of ["93.184.216.34", "2606:4700:4700::1111"])
    assert.equal(publicAddress(address), true, address);
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.com",
    "https://user:secret@example.com",
    "https://example.com:444",
  ])
    assert.throws(() => publicLink(url));
  for (const url of [
    "http://2130706433",
    "http://0x7f000001",
    "http://[::ffff:127.0.0.1]",
  ])
    assert.equal(await getLinkPreview(url), null);
  mock.method(dns, "lookup", async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.1", family: 4 },
  ]);
  assert.equal(await getLinkPreview(link("/mixed")), null);
});
test("redirects are revalidated, DNS is pinned, sanitized images are bounded and duplicate requests share the cache", async () => {
  const requests = transport();
  const url = link("/redirect");
  const [preview, duplicate] = await Promise.all([
    getLinkPreview(url),
    getLinkPreview(url),
  ]);
  assert.ok(preview?.image);
  assert.equal(duplicate, preview);
  assert.equal(preview.title, "Field notes & ideas");
  assert.equal(preview.url, url);
  assert.equal(requests.length, 3);
  assert.equal(await getLinkPreview(url), preview);
  assert.equal(requests.length, 3);
  const metadata = await sharp(
    Buffer.from(preview.image.data, "base64"),
  ).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
  assert.ok(metadata.width! <= 1200 && metadata.height! <= 630);
  assert.ok(preview.image.data.length < 280_000);
  assert.equal(await getLinkPreview(link("/private")), null);
  assert.equal(await getLinkPreview(link("/loop")), null);
  assert.equal(
    requests.some((value) => value.includes("127.0.0.1")),
    false,
  );
  assert.equal(await getLinkPreview(link("/empty")), null);
  assert.ok((await getLinkPreview(link("/large-page")))?.image);
  for (const path of ["/private-image", "/huge-image", "/broken-image"]) {
    const card = await getLinkPreview(link(path));
    assert.ok(card?.title, path);
    assert.equal(card.image, undefined, path);
  }
});
test("slow metadata times out without hanging or dropping the post text", async () => {
  transport();
  const start = Date.now();
  assert.equal(await getLinkPreview(link("/slow")), null);
  assert.ok(Date.now() - start < 6500);
});
test("link preview requires authentication and accepts the existing read policy", async () => {
  await resetDatabase();
  assert.equal(
    (await request("/api/link-preview?url=https://example.com")).status,
    401,
  );
  const user = await setupUser();
  assert.equal(
    (await request("/api/link-preview?url=invalid", { cookie: user.cookie }))
      .status,
    400,
  );
  const response = await request("/api/link-preview?url=http://127.0.0.1", {
    cookie: user.cookie,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { preview: null });
});
test("LinkedIn uploads the OG thumbnail before publishing an article and preserves attached media precedence", async () => {
  transport();
  const url = link("/story");
  const payloads: Record<string, unknown>[] = [];
  let uploads = 0;
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : String(input))
        .pathname;
      if (path === "/rest/images")
        return Response.json({
          value: {
            image: "urn:li:image:og",
            uploadUrl: "https://www.linkedin.com/upload/og",
          },
        });
      if (path === "/upload/og") {
        uploads++;
        assert.equal(
          new Headers(init?.headers).get("Content-Type"),
          "image/jpeg",
        );
        return new Response(null, { status: 201 });
      }
      if (path === "/rest/posts") {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response(null, {
          status: 201,
          headers: { "x-restli-id": "urn:li:share:local" },
        });
      }
      throw new Error("Unexpected provider call");
    },
  );
  const job = {
    id: randomUUID(),
    provider: "linkedin",
    accountId: "fixture",
    text: `Read ${url}`,
  } as DeliveryJob;
  const prepared = await preparePublication(job, [], "disposable-token");
  assert.equal(payloads.length, 0);
  assert.equal(uploads, 1);
  await prepared.publish();
  assert.deepEqual(payloads.at(-1)?.content, {
    article: {
      source: url,
      title: "Field notes & ideas",
      description: "A useful story.",
      thumbnail: "urn:li:image:og",
    },
  });
  const before = hits.length;
  const media = await preparePublication(
    { ...job, text: `Read ${link("/story")}` },
    [
      {
        id: randomUUID(),
        bytes: Buffer.from("image"),
        width: 100,
        height: 100,
        alt: "Attached",
      },
    ],
    "disposable-token",
  );
  await media.publish();
  assert.equal(hits.length, before);
  assert.deepEqual(payloads.at(-1)?.content, {
    media: { id: "urn:li:image:og", altText: "Attached" },
  });
  const plain = await preparePublication(
    { ...job, text: `Read ${link("/empty")}` },
    [],
    "disposable-token",
  );
  await plain.publish();
  assert.equal(payloads.at(-1)?.content, undefined);
});

test("Bluesky prepares an external card blob before publishing its deterministic record", async (t) => {
  transport();
  const original = {
    api: process.env.POSTED_API_URL,
    web: process.env.POSTED_WEB_URL,
  };
  process.env.POSTED_API_URL = "https://posted-api.example.test";
  process.env.POSTED_WEB_URL = "https://posted.example.test";
  process.env.POSTED_BLUESKY_CLIENT_ID =
    "https://posted-api.example.test/social/bluesky/client-metadata.json";
  const { generateKeyPairSync } = await import("node:crypto");
  process.env.POSTED_BLUESKY_PRIVATE_KEY_JWK = JSON.stringify(
    generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
      format: "jwk",
    }),
  );
  t.after(() => {
    process.env.POSTED_API_URL = original.api;
    process.env.POSTED_WEB_URL = original.web;
    delete process.env.POSTED_BLUESKY_CLIENT_ID;
    delete process.env.POSTED_BLUESKY_PRIVATE_KEY_JWK;
  });
  const { blueskyClient } = await import("../apps/api/src/social/bluesky.js");
  const client = await blueskyClient();
  const did = "did:plc:abcdefghijklmnopqrstuvwx";
  const cid = "bafkreigh2akiscaildcf5go4k2f4i4u7lhzgxmxzjzzxtfa4u4ajp5z7ai";
  const records: Record<string, unknown>[] = [];
  let uploads = 0;
  mock.method(client, "restore", async () => ({
    did,
    fetchHandler: async (input: string | URL, init?: RequestInit) => {
      const path = new URL(String(input), "https://pds.example.test").pathname;
      if (path === "/xrpc/com.atproto.repo.uploadBlob") {
        uploads++;
        assert.equal(
          new Headers(init?.headers).get("Content-Type"),
          "image/jpeg",
        );
        return Response.json({
          blob: {
            $type: "blob",
            ref: { $link: cid },
            mimeType: "image/jpeg",
            size: 100,
          },
        });
      }
      if (path === "/xrpc/com.atproto.repo.putRecord") {
        const body = JSON.parse(
          typeof init?.body === "string"
            ? init.body
            : Buffer.from(init?.body as Uint8Array).toString(),
        );
        assert.equal(body.rkey, `posted-${job.id}`);
        records.push(body.record);
        return Response.json({
          uri: `at://${did}/app.bsky.feed.post/${body.rkey}`,
          cid,
        });
      }
      throw new Error("Unexpected Bluesky call");
    },
  }));
  const url = link("/story");
  const job = {
    id: randomUUID(),
    provider: "bluesky",
    accountId: did,
    text: `Read ${url}`,
  } as DeliveryJob;
  const prepared = await preparePublication(job, []);
  assert.equal(uploads, 1);
  assert.equal(records.length, 0);
  await prepared.publish();
  const embed = records[0]!.embed as {
    $type: string;
    external: { uri: string; title: string; thumb: { mimeType: string } };
  };
  assert.equal(embed.$type, "app.bsky.embed.external");
  assert.equal(embed.external.uri, url);
  assert.equal(embed.external.title, "Field notes & ideas");
  assert.equal(embed.external.thumb.mimeType, "image/jpeg");
});
