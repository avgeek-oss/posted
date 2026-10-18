import { normalizeVideo } from "../apps/api/src/media/video.js";
import { gifMetadata, normalizeGif } from "../apps/api/src/media/gif.js";
import { gifFixture } from "./gif-fixture.js";
import { videoFixture, videoFrame } from "./video-fixture.js";
import {
  mediaForProvider,
  mediaError,
} from "../packages/contracts/src/media.js";
import { fileTypeFromBuffer } from "file-type";
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { prepareImage } from "../apps/api/src/media/prepare.js";
import { enabledProviders } from "../apps/api/src/social/capabilities.js";
import { seal, unseal } from "../apps/api/src/social/secrets.js";
import { validateProviderContent } from "../apps/api/src/posts/input.js";
import { reorderItems } from "../apps/web/src/item-order.js";
import {
  characterLimits,
  providerTextLength,
  textForProviderPreview,
} from "../packages/contracts/src/text.js";

test("preview text stops at provider limits without splitting emoji or weighted URLs", () => {
  for (const provider of ["x", "linkedin", "bluesky", "threads"] as const) {
    const text = "a".repeat(characterLimits[provider] + 1);
    assert.equal(
      textForProviderPreview(provider, text),
      "a".repeat(characterLimits[provider]),
    );
    assert.equal(textForProviderPreview(provider, "Short post"), "Short post");
  }
  assert.equal(
    textForProviderPreview("bluesky", "👩‍💻".repeat(301)),
    "👩‍💻".repeat(300),
  );
  assert.equal(
    textForProviderPreview("threads", "😀".repeat(501)),
    "😀".repeat(500),
  );
  assert.equal(textForProviderPreview("x", "界".repeat(141)), "界".repeat(140));
  const link = "https://example.com/" + "a".repeat(400);
  const prefix = `Read ${link} `;
  const preview = textForProviderPreview("x", prefix + "a".repeat(300));
  assert.ok(preview.startsWith(prefix));
  assert.equal(providerTextLength("x", preview), characterLimits.x);
});

test("delivery images meet each provider's bounds and remove EXIF metadata", async () => {
  const original = await sharp({
    create: { width: 4800, height: 2200, channels: 4, background: "#2253b880" },
  })
    .png()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const providerBounds = [
    ["x", 5_000_000, 4096],
    ["linkedin", 5_000_000, 4096],
    ["bluesky", 2_000_000, 4000],
    ["threads", 8_000_000, 1440],
  ] as const;
  for (const [provider, maxBytes, maxDimension] of providerBounds) {
    const result = await prepareImage(original, provider);
    const info = await sharp(result.bytes).metadata();
    assert.equal(info.format, "jpeg");
    assert.equal(info.exif, undefined);
    assert.ok(result.bytes.length <= maxBytes);
    assert.ok(result.width <= maxDimension);
    assert.ok(result.height <= maxDimension);
    assert.ok(
      result.height > result.width,
      "rotation respects the original orientation",
    );
  }
});
test("large detailed images are compressed to the Bluesky upload limit", async () => {
  const original = await sharp(randomBytes(4000 * 4000 * 3), {
    raw: { width: 4000, height: 4000, channels: 3 },
  })
    .png()
    .toBuffer();
  assert.ok(original.length > 2_000_000);
  const result = await prepareImage(original, "bluesky");
  assert.ok(result.bytes.length <= 2_000_000);
  assert.ok(result.width > 1000, "compression retains useful resolution");
  assert.ok(result.width <= 4000);
  assert.equal(result.width, result.height);
  const image = await sharp(result.bytes).metadata();
  assert.equal(image.format, "jpeg");
});
test("extreme image ratios are cropped and invalid images fail", async () => {
  const original = await sharp({
    create: { width: 9000, height: 100, channels: 3, background: "#2253b8" },
  })
    .png()
    .toBuffer();
  const result = await prepareImage(original, "threads");
  assert.ok(result.width / result.height <= 10);
  await assert.rejects(() => prepareImage(Buffer.from("not an image"), "x"));
});
test("encryption binds secrets to the connected account and rejects tampering", () => {
  const ciphertext = seal({ token: "disposable" }, "account-1");
  assert.deepEqual(unseal(ciphertext, "account-1"), { token: "disposable" });
  assert.throws(() => unseal(ciphertext, "account-2"));
  assert.throws(() => unseal(ciphertext + "x", "account-1"));
  assert.equal(ciphertext.includes("disposable"), false);
});
test("only fully configured providers appear, and text/image limits use provider semantics", () => {
  assert.deepEqual(enabledProviders({ POSTED_X_CLIENT_ID: "client" }), []);
  assert.deepEqual(
    enabledProviders({
      POSTED_X_CLIENT_ID: "client",
      POSTED_X_CLIENT_SECRET: "secret",
    }).map((p) => p.id),
    ["x"],
  );
  assert.doesNotThrow(() =>
    validateProviderContent(
      "x",
      `A link ${"https://example.com/" + "a".repeat(300)}`,
      1,
    ),
  );
  assert.throws(() => validateProviderContent("x", "界".repeat(141), 0));
  assert.doesNotThrow(() =>
    validateProviderContent("bluesky", "👩‍💻".repeat(300), 0),
  );
  assert.throws(() => validateProviderContent("bluesky", "hello", 5));
});

test("image priority survives reordering and each provider uses its supported prefix", () => {
  const original = Array.from({ length: 20 }, (_, index) => ({
    id: String(index),
    contentType: "image/png",
    durationSeconds: null,
  }));
  const reordered = reorderItems(
    original,
    new Set(["19", "17"]),
    "0",
    "before",
  );
  assert.deepEqual(
    reordered.slice(0, 4).map((image) => image.id),
    ["17", "19", "0", "1"],
  );
  assert.deepEqual(
    mediaForProvider("x", reordered).map((image) => image.id),
    ["17", "19", "0", "1"],
  );
  assert.deepEqual(
    mediaForProvider("bluesky", reordered),
    mediaForProvider("x", reordered),
  );
  assert.deepEqual(mediaForProvider("linkedin", reordered), reordered);
  assert.deepEqual(mediaForProvider("threads", reordered), reordered);
  assert.equal(original[0].id, "0");
  assert.equal(original[19].id, "19");
  assert.deepEqual(
    reorderItems(original, new Set(["0"]), "2", "after")
      .slice(0, 4)
      .map((image) => image.id),
    ["1", "2", "0", "3"],
  );
});

test("video preparation normalizes MOV for playback and publishing and removes private metadata", async () => {
  const source = await videoFixture("mov");
  assert.equal((await fileTypeFromBuffer(source))?.mime, "video/quicktime");
  const prepared = await normalizeVideo(source);
  assert.equal((await fileTypeFromBuffer(prepared.bytes))?.mime, "video/mp4");
  assert.equal(prepared.contentType, "video/mp4");
  assert.ok(prepared.durationSeconds >= 3 && prepared.durationSeconds < 4);
  assert.ok(prepared.width <= 1280 && prepared.height <= 720);
  assert.equal(
    prepared.bytes.includes(Buffer.from("private-video-fixture")),
    false,
  );
  await assert.rejects(normalizeVideo(Buffer.from("not a video")));
  await assert.rejects(normalizeVideo(await videoFixture("mp4", 1)));
});

test("GIF preparation preserves frames and timing, strips metadata and creates a still thumbnail", async () => {
  const source = await gifFixture();
  const before = await gifMetadata(source);
  assert.equal(before.frames, 4);
  const ready = await normalizeGif(source);
  assert.equal(ready.contentType, "image/gif");
  const result = await gifMetadata(ready.bytes);
  assert.equal(result.frames, before.frames);
  assert.deepEqual(result.delays, before.delays);
  assert.equal(result.durationSeconds, 0.8);
  assert.equal(result.width, 160);
  assert.equal(result.height, 90);
  assert.ok(ready.bytes.length <= 5_000_000);
  assert.equal(ready.bytes.includes(Buffer.from("private-gif-fixture")), false);
  assert.ok(ready.thumbnail);
  assert.equal((await fileTypeFromBuffer(ready.thumbnail))?.mime, "image/png");
  assert.equal((await sharp(ready.thumbnail).metadata()).pages ?? 1, 1);
  await assert.rejects(prepareImage(source, "x"), /preserve its frames/);
  const still = await normalizeGif(await gifFixture(1));
  assert.equal(still.contentType, "image/jpeg");
  assert.equal(still.durationSeconds, null);
});

test("GIF limits reject excessive frames, duration and malformed input before conversion", async () => {
  await assert.rejects(normalizeGif(await gifFixture(251)), /250 frames/);
  await assert.rejects(normalizeGif(await gifFixture(4, 50000)), /3 minutes/);
  await assert.rejects(normalizeGif(Buffer.from("not a GIF")));
});

test("GIF video conversion retains changing frames and loops short animations to the video minimum", async () => {
  const animation = await normalizeGif(await gifFixture());
  const converted = await normalizeVideo(animation.bytes, "gif");
  assert.equal(converted.contentType, "video/mp4");
  assert.ok(converted.durationSeconds >= 3 && converted.durationSeconds <= 3.3);
  const first = await sharp(await videoFrame(converted.bytes, 0.1)).stats();
  const second = await sharp(await videoFrame(converted.bytes, 0.3)).stats();
  assert.ok(first.dominant.r > 200 && first.dominant.g < 40);
  assert.ok(second.dominant.g > 200 && second.dominant.r < 40);
  const repeated = await sharp(await videoFrame(converted.bytes, 0.9)).stats();
  assert.ok(repeated.dominant.r > 200 && repeated.dominant.g < 40);
  assert.equal(
    converted.bytes.includes(Buffer.from("private-gif-fixture")),
    false,
  );
});

test("a GIF cannot be silently combined with other attachment types", () => {
  const gif = { contentType: "image/gif", durationSeconds: 0.8 };
  const image = { contentType: "image/png", durationSeconds: null };
  for (const provider of ["x", "linkedin", "bluesky", "threads"] as const) {
    assert.equal(mediaError(provider, [gif]), undefined);
    assert.match(mediaError(provider, [gif, image]) ?? "", /one GIF/);
    assert.match(mediaError(provider, [gif, gif]) ?? "", /one GIF/);
  }
});
test("media priority and early account validation match each provider's supported combinations", () => {
  const image = {
    id: "image",
    contentType: "image/png",
    durationSeconds: null,
  };
  const first = { id: "first", contentType: "video/mp4", durationSeconds: 10 };
  const second = { ...first, id: "second" };
  for (const provider of ["x", "linkedin", "bluesky"] as const) {
    assert.deepEqual(mediaForProvider(provider, [second, first]), [second]);
    assert.ok(mediaError(provider, [image, first]));
  }
  assert.equal(mediaError("threads", [image, first]), undefined);
  assert.deepEqual(mediaForProvider("threads", [image, second, first]), [
    image,
    second,
    first,
  ]);
  assert.ok(mediaError("x", [{ ...first, durationSeconds: 141 }]));
  assert.ok(mediaError("bluesky", [{ ...first, durationSeconds: 181 }]));
  assert.ok(mediaError("threads", [{ ...first, durationSeconds: 301 }]));
  assert.equal(
    mediaError("linkedin", [{ ...first, durationSeconds: 301 }]),
    undefined,
  );
});
