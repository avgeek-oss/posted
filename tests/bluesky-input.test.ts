import assert from "node:assert/strict";
import { test } from "node:test";
import { safeFetchWrap } from "@atproto-labs/fetch-node";
import { blueskyLoginSchema } from "../apps/api/src/social/bluesky-input.js";

test("Bluesky accepts custom handles and public HTTPS server origins", () => {
  assert.equal(blueskyLoginSchema.parse(" @Avgeek.IO "), "avgeek.io");
  assert.equal(
    blueskyLoginSchema.parse("name.bsky.social"),
    "name.bsky.social",
  );
  assert.equal(
    blueskyLoginSchema.parse("https://bsky.social/"),
    "https://bsky.social",
  );
  assert.equal(
    blueskyLoginSchema.parse("https://pds.example.com"),
    "https://pds.example.com",
  );
  for (const input of [
    "",
    "not a handle",
    "http://bsky.social",
    "https://user:password@bsky.social",
    "https://bsky.social:8443",
    "https://bsky.social/path",
    "https://bsky.social?token=private",
    "https://bsky.social#fragment",
    "https://localhost",
    "https://pds.local",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://169.254.169.254",
    "https://[::1]",
  ])
    assert.equal(blueskyLoginSchema.safeParse(input).success, false, input);
});

test("Bluesky discovery cannot send a request to a private address", async () => {
  const fetch = safeFetchWrap({ allowImplicitRedirect: true });
  await assert.rejects(
    fetch("https://127.0.0.1/.well-known/oauth-protected-resource"),
    (error: unknown) => {
      assert.ok(error instanceof Error && error.cause instanceof Error);
      assert.match(error.cause.message, /non-unicast/);
      return true;
    },
  );
});
