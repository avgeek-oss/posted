import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { metaJson } from "../apps/api/src/social/meta-api.js";
import { ProviderFailure } from "../apps/api/src/social/network.js";

afterEach(() => mock.restoreAll());
const endpoint = new URL("https://graph.facebook.com/v26.0/123/feed");
for (const body of ["", "not JSON"]) {
  test(`Explicit non-JSON throttling remains retryable (${JSON.stringify(body)})`, async () => {
    mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(body, {
          status: 429,
          headers: { "Retry-After": "120" },
        }),
    );
    await assert.rejects(
      metaJson(endpoint, "test-token", z.object({ id: z.string() })),
      (error) =>
        error instanceof ProviderFailure &&
        error.status === 429 &&
        !error.uncertain &&
        error.retryAfterMs === 120_000,
    );
  });
}
test("Meta honors HTTP-date cooldowns and normalizes Page rate limits", async () => {
  const until = new Date(Date.now() + 600_000).toUTCString();
  mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: { code: 80001, is_transient: true } },
      {
        status: 403,
        headers: { "Retry-After": until },
      },
    ),
  );
  await assert.rejects(
    metaJson(endpoint, "test-token", z.object({ id: z.string() })),
    (error) =>
      error instanceof ProviderFailure &&
      error.status === 429 &&
      !error.uncertain &&
      error.retryAfterMs > 598_000 &&
      error.retryAfterMs <= 600_000,
  );
});
test("Malformed successful publication responses remain uncertain", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () => new Response("not JSON", { status: 200 }),
  );
  await assert.rejects(
    metaJson(endpoint, "test-token", z.object({ id: z.string() })),
    (error) => error instanceof ProviderFailure && error.uncertain,
  );
});
