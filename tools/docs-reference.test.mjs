import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const spec = JSON.parse(
  await readFile(
    new URL("../docs/api-reference/openapi.json", import.meta.url),
  ),
);
const operation = (method, path) => spec.paths[path][method];
const body = (method, path, mime = "application/json") =>
  operation(method, path).requestBody.content[mime].schema;

test("reference keeps human security management separate from REST and MCP credentials", () => {
  for (const path of [
    "/api/auth/profile",
    "/api/auth/passkeys/register/options",
    "/api/credentials",
  ])
    for (const value of Object.values(spec.paths[path]))
      assert.deepEqual(value.security, [{ sessionCookie: [] }]);
  assert.deepEqual(operation("get", "/api/posts").security, [
    { bearerAuth: [] },
    { sessionCookie: [] },
  ]);
  assert.deepEqual(operation("post", "/mcp").security, [{ mcpBearer: [] }]);
  assert.equal(
    spec.components.securitySchemes.sessionCookie.name,
    "posted_session",
  );
});

test("reference retains content-bound retries and guarded draft deletion", () => {
  const create = body("post", "/api/posts");
  assert(create.required.includes("idempotencyKey"));
  assert(create.properties.draftSource.required.includes("version"));
  const update = body("patch", "/api/posts/{postId}");
  assert(update.required.includes("version"));
  assert(!("postId" in update.properties));
  const remove = operation("delete", "/api/drafts/{draftId}");
  assert(
    remove.parameters.some(
      (value) =>
        value.name === "draftId" && value.in === "path" && value.required,
    ),
  );
  assert.deepEqual(body("delete", "/api/drafts/{draftId}").required, [
    "version",
  ]);
  assert(!operation("delete", "/api/posts/{postId}").requestBody);
});

test("reference distinguishes asynchronous media processing and OAuth form requests", () => {
  assert(operation("post", "/api/media/{mediaId}/complete").responses["202"]);
  assert(body("post", "/oauth/token", "application/x-www-form-urlencoded"));
  assert.equal(
    operation("get", "/mcp").responses["200"].content["text/event-stream"]
      .schema.type,
    "string",
  );
});

test("each documented operation has its own OpenAPI page and navigation entry", async () => {
  const site = JSON.parse(
    await readFile(new URL("../docs/site.json", import.meta.url)),
  );
  const flatten = (items) =>
    items.flatMap((item) =>
      typeof item === "string"
        ? [item]
        : flatten(item.pages ?? item.groups ?? []),
    );
  const routes = flatten(
    site.navigation.dropdowns.flatMap((item) => item.groups),
  );
  for (const [path, methods] of Object.entries(spec.paths))
    for (const [method, value] of Object.entries(methods)) {
      const route = `api-reference/${value.operationId}`;
      assert(
        routes.includes(route),
        `${method} ${path} is missing from navigation`,
      );
      const page = await readFile(
        new URL(`../docs/${route}.mdx`, import.meta.url),
        "utf8",
      );
      assert(
        page.includes(
          `/api-reference/openapi.json ${method.toUpperCase()} ${path}`,
        ),
      );
      assert(page.includes("playground: simple"));
    }
});
