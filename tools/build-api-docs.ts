import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { format } from "prettier";
import type { Endpoint } from "./docs-reference-data.js";
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
const { illustrations, supplementalEndpoints } =
  await import("./docs-reference-data.js");
const { tools } = await import("../apps/api/src/external/tools.js");
const { app } = await import("../apps/api/src/app.js");
const { closeDatabase } = await import("../packages/database/src/index.js");
const check = process.argv.includes("--check");
type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  description?: string;
  enum?: unknown[];
  format?: string;
  [key: string]: unknown;
};
const canonical = (path: string) => path.replace(/:[A-Za-z]+|\{[^}]+\}/g, "{}");
const openPath = (path: string) => path.replace(/:([A-Za-z]+)/g, "{$1}");
const slug = (method: string, path: string) =>
  `${method.toLowerCase()}_${path
    .replace(/:([A-Za-z]+)/g, "by_$1")
    .replace(/[/.-]+/g, "_")
    .replace(/^_|_$/g, "")}`;
const jsonSchema = (schema: z.ZodType): Schema => {
  const value = z.toJSONSchema(schema, { unrepresentable: "any", io: "input" });
  const { $schema: _, ...rest } = value;
  return rest as Schema;
};
const block = (language: string, value: unknown) =>
  `\n\`\`\`${language}\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n\`\`\`\n`;
const describe = (schema: Schema) =>
  schema.description ??
  (schema.enum
    ? schema.enum.map(String).join(", ")
    : (schema.format ??
      (Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type) ??
      "JSON value"));
const authText: Record<Endpoint["auth"], string> = {
  public:
    "No signed-in session is required. Endpoint-specific tokens, setup secrets or challenges may still be required.",
  session:
    "A signed-in human session is required. API keys and MCP bearer credentials cannot replace that session.",
  recent:
    "A signed-in human session with recent authentication is required. Complete password/passkey reauthentication when requested.",
  "admin-session":
    "A signed-in human administrator is required. API keys and MCP credentials cannot replace that session. Sensitive operations can also require recent authentication.",
  read: "Read access: a read-enabled personal or team REST API key, or a signed-in user. OAuth clients use the corresponding MCP tool through /mcp.",
  write:
    "Write access: a member/administrator with a write-enabled credential, or an authorized signed-in user.",
  admin:
    "Administrator access with explicit administrator permission on API keys or MCP credentials, or a signed-in administrator.",
  "oauth-client":
    "Authenticate the OAuth client using its registered method: none, client_secret_basic or client_secret_post. Client credentials are distinct from a user's API key.",
  mcp: "An OAuth bearer token issued for this installation's MCP resource is required. Static REST API keys cannot access /mcp.",
};
const argumentDescriptions: Record<string, string> = {
  text: "Master text for this post. Account overrides take precedence.",
  textOverrides:
    "Selected connection ID to custom text; omit a key to inherit the master.",
  connectionIds:
    "Selected connected accounts belonging to this team; applies to the complete sequence.",
  mediaIds: "Ready media IDs in attachment order for this master post.",
  mediaOverrides:
    "Selected connection ID to ordered media IDs; omit to inherit, or use [] for no attachments.",
  additionalPosts:
    "Later posts in order; each has text, mediaIds and optional account overrides.",
  scheduledAt:
    "ISO 8601 UTC timestamp. Use a future time to schedule; use the current time only after publication confirmation.",
  idempotencyKey:
    "One content-bound request key; reuse with the identical payload when retrying.",
  draftSource:
    "Saved draft ID and current version, for one-time conversion into a posting group.",
  version: "Latest record version; use 0 only when creating a new draft.",
  postId: "Posting-group UUID returned by list_posts or create_post.",
  draftId:
    "Draft UUID; choose a new UUID when creating, or read the saved draft before updating.",
  connectionId: "Team social-account UUID returned by list_connections.",
  mediaId: "Uploaded media UUID returned by reserve_media_upload.",
  page: "One-based page number.",
  pageSize: "Records per numbered page, at most 100.",
  view: "scheduled for pending work, history for groups without active deliveries.",
  limit: "Maximum records to return; use the endpoint-specific upper bound.",
  fileName: "Original file name, including its extension.",
  contentType: "Supported MIME type matching the exact uploaded bytes.",
  sizeBytes: "Exact file size in bytes; the uploaded body must match.",
  alt: "Alternative text describing the image or video.",
  name: "The name to save for the target record.",
};
const groupFor = (path: string) =>
  path.includes("/drafts")
    ? "Drafts"
    : path.includes("/posts")
      ? "Posts"
      : path.includes("/media")
        ? "Media"
        : path.includes("/workspace") || path.includes("/members")
          ? "Team"
          : "Social connections";
const snapshot = tools.map((tool) => ({
  name: tool.name,
  method: tool.method,
  path: tool.path,
  description: tool.description,
  readOnly: tool.readOnly,
  administrator: Boolean(tool.admin),
  input: z.toJSONSchema(tool.input, { unrepresentable: "any" }),
}));
const generated = new Map<string, string>();
const emit = async (
  path: string,
  body: string,
  parser: "mdx" | "json" = "mdx",
) => {
  const formatted = await format(body, { parser });
  generated.set(path, formatted);
};
const mcpNavigation = new Map<string, string[]>();
const endpoints: (Endpoint & {
  toolName?: string;
  inputExample?: Record<string, unknown>;
})[] = [...supplementalEndpoints];
for (const tool of tools) {
  const group = groupFor(tool.path);
  mcpNavigation.set(group, [
    ...(mcpNavigation.get(group) ?? []),
    `mcp-reference/${tool.name}`,
  ]);
  const example = illustrations[tool.name];
  assert(example, `Missing illustration for ${tool.name}`);
  tool.input.parse(example.input);
  const pathNames = [...tool.path.matchAll(/:([A-Za-z]+)/g)].map(
    (match) => match[1]!,
  );
  const schema = z
    .object(
      Object.fromEntries(
        Object.entries(tool.input.shape).filter(
          ([name]) => !pathNames.includes(name),
        ),
      ),
    )
    .strict();
  const inputExample = Object.fromEntries(
    Object.entries(example.input).filter(([key]) => !pathNames.includes(key)),
  );
  endpoints.push({
    method: tool.method,
    path: tool.path,
    title: example.title,
    group,
    auth: tool.admin ? "admin" : tool.readOnly ? "read" : "write",
    description: `${tool.description}\n\n${example.note}`,
    ...(tool.method === "GET"
      ? { query: schema }
      : Object.keys(schema.shape).length
        ? { body: schema }
        : {}),
    result: example.result,
    toolName: tool.name,
    inputExample,
    status: ["create_post", "save_draft", "reserve_media_upload"].includes(
      tool.name,
    )
      ? 201
      : 200,
  });
  const input = jsonSchema(tool.input);
  const fields = Object.entries(input.properties ?? {})
    .map(
      ([name, field]) =>
        `| \`${name}\` | ${input.required?.includes(name) ? "Yes" : "No"} | ${(argumentDescriptions[name] ?? describe(field)).replaceAll("|", "\\|")} |`,
    )
    .join("\n");
  const flow = example.workflow
    .map(
      (step, i) =>
        `  step${i}["${step}"]${i < example.workflow.length - 1 ? ` --> step${i + 1}` : ""}`,
    )
    .join("\n");
  await emit(
    `docs/mcp-reference/${tool.name}.mdx`,
    `---\ntitle: ${JSON.stringify(tool.name)}\ndescription: ${JSON.stringify(example.title + " with Posted MCP.")}\nicon: "/assets/icons/mcp.svg"\n---\n\n${tool.description}\n\n## Workflow\n\n${block("mermaid", `flowchart LR\n${flow}`)}\n\n## Access and behavior\n\n${tool.admin ? "Administrator consent and a current administrator team role are required." : tool.readOnly ? "A Read-only, Write or Administrator OAuth grant can call this tool within the user’s current team role." : "Write or Administrator OAuth consent and a member/administrator team role are required."} Tools are listed and callable only when the current grant and role permit them.\n\n${example.note}\n\n${tool.destructive ? "<Warning>Confirm the exact target and consequence with the user before calling this tool.</Warning>\n\n" : ""}## Arguments\n\n| Argument | Required | Type or meaning |\n| --- | --- | --- |\n${fields || "| None | No | Pass an empty object. |"}\n\n<Accordion title="Complete input schema">\n${block("json", input)}\n</Accordion>\n\n## Example call\n\nThe client initializes the MCP connection before sending this JSON-RPC call. Example records are fictional.\n${block("json", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool.name, arguments: example.input } })}\n\n## Example result\n\nPosted returns this object in \`structuredContent\` and a JSON text content block. A tool failure sets \`isError\`; never treat an error as a completed mutation.\n${block("json", example.result)}\n\n## Related reference\n\n[HTTP operation](/api-reference/${slug(tool.method, tool.path)}) · [Connect an MCP client](/mcp-connections) · [Request conventions](/api-reference/overview)\n`,
  );
}
const expected = new Set(
  app.routes
    .filter((route) =>
      ["GET", "POST", "PATCH", "DELETE", "PUT"].includes(route.method),
    )
    .map((route) => `${route.method} ${canonical(route.path)}`),
);
for (const method of ["POST", "GET", "DELETE"]) expected.add(`${method} /mcp`);
const actual = new Set(
  endpoints.map((route) => `${route.method} ${canonical(route.path)}`),
);
assert.equal(actual.size, endpoints.length, "Duplicate endpoint documentation");
assert.deepEqual(
  [...actual].sort(),
  [...expected].sort(),
  "Every registered HTTP operation must have exactly one reference page",
);
const paths: Record<string, Record<string, unknown>> = {};
const resultSchema = (value: unknown): Schema => {
  if (value === null) return { type: ["string", "null"] };
  if (Array.isArray(value))
    return { type: "array", items: value.length ? resultSchema(value[0]) : {} };
  if (typeof value === "object")
    return {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, field]) => [
          key,
          resultSchema(field),
        ]),
      ),
      additionalProperties: true,
    };
  return {
    type:
      typeof value === "number"
        ? Number.isInteger(value)
          ? "integer"
          : "number"
        : typeof value,
  };
};
const navigation = new Map<string, string[]>();
for (const endpoint of endpoints) {
  const operationId = slug(endpoint.method, endpoint.path);
  const route = `api-reference/${operationId}`;
  navigation.set(endpoint.group, [
    ...(navigation.get(endpoint.group) ?? []),
    route,
  ]);
  const bodySchema = endpoint.body ? jsonSchema(endpoint.body) : undefined;
  const querySchema = endpoint.query ? jsonSchema(endpoint.query) : undefined;
  if (endpoint.path === "/api/auth/members" && querySchema?.properties)
    querySchema.properties.cursor = {
      type: "string",
      description:
        "Opaque nextCursor from the preceding REST response. This parameter is not exposed by list_members.",
    };
  const parameters: Record<string, unknown>[] = [
    ...endpoint.path.matchAll(/:([A-Za-z]+)/g),
  ].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema:
      match[1] === "provider"
        ? { type: "string", enum: ["x", "threads", "linkedin", "bluesky"] }
        : {
            type: "string",
            ...(endpoint.path.includes("/passkeys/") ? {} : { format: "uuid" }),
          },
    description: `The ${match[1]} from the corresponding list, record or authorization response.`,
  }));
  for (const [name, schema] of Object.entries(querySchema?.properties ?? {}))
    parameters.push({
      name,
      in: "query",
      required: querySchema?.required?.includes(name) ?? false,
      schema,
      description: describe(schema),
    });
  if (
    ["session", "recent", "admin-session"].includes(endpoint.auth) &&
    endpoint.method !== "GET"
  )
    parameters.push({
      name: "Origin",
      in: "header",
      required: true,
      schema: { type: "string", format: "uri" },
      description:
        "The exact configured Posted UI origin. Required for browser mutations carrying session cookies.",
    });
  if (endpoint.path === "/mcp")
    parameters.push({
      name: "Accept",
      in: "header",
      required: true,
      schema: { type: "string" },
      description:
        endpoint.method === "GET"
          ? "text/event-stream"
          : "application/json, text/event-stream",
    });
  const status = String(endpoint.status ?? 200);
  const response = {
    description:
      status === "302"
        ? "Redirect to the authorization, consent or UI destination."
        : status === "405"
          ? "This stateless MCP transport does not support the requested session operation."
          : "Successful response. Examples are illustrative; field values vary by record.",
    ...(endpoint.path === "/mcp" && endpoint.method === "GET"
      ? { content: { "text/event-stream": { schema: { type: "string" } } } }
      : {}),
    ...(endpoint.result
      ? {
          content: {
            "application/json": {
              schema: resultSchema(endpoint.result),
              example: endpoint.result,
            },
          },
        }
      : {}),
    ...(status === "302"
      ? {
          headers: {
            Location: {
              schema: { type: "string", format: "uri" },
              description: "Redirect destination",
            },
          },
        }
      : {}),
  };
  const responses: Record<string, unknown> = { [status]: response };
  if (["save_draft", "create_post"].includes(endpoint.toolName ?? ""))
    responses["200"] = {
      ...response,
      description: "Existing operation replay or saved-draft update.",
    };
  if (endpoint.toolName === "complete_media_upload")
    responses["202"] = {
      description: "Video preparation is still processing; poll media status.",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { state: { const: "processing" } },
          },
          example: { state: "processing" },
        },
      },
    };
  if (endpoint.toolName === "get_media_status")
    (responses["200"] as { description: string }).description =
      "Ready includes media metadata; uploading or processing returns only state.";
  const oauth =
    endpoint.path.startsWith("/oauth/") ||
    endpoint.path.startsWith("/api/oauth/");
  responses.default = {
    description: oauth
      ? "OAuth failure with error and error_description. Consent/session authority may also return the standard Posted error envelope."
      : "Request failure. Inspect code, message and requestId; respect Retry-After on HTTP 429.",
    content: {
      "application/json": {
        schema: oauth
          ? {
              type: "object",
              properties: {
                error: { type: "string" },
                error_description: { type: "string" },
              },
            }
          : { $ref: "#/components/schemas/Error" },
      },
    },
  };
  const security =
    endpoint.auth === "public"
      ? []
      : endpoint.auth === "oauth-client"
        ? [{ oauthClientBasic: [] }, {}]
        : endpoint.auth === "mcp"
          ? [{ mcpBearer: [] }]
          : ["session", "recent", "admin-session"].includes(endpoint.auth)
            ? [{ sessionCookie: [] }]
            : [{ bearerAuth: [] }, { sessionCookie: [] }];
  const operation = {
    operationId,
    summary: endpoint.title,
    description: `${endpoint.description}\n\n${authText[endpoint.auth]}`,
    tags: [endpoint.group],
    security,
    ...(parameters.length ? { parameters } : {}),
    ...(bodySchema
      ? {
          requestBody: {
            required: true,
            content: {
              [endpoint.form
                ? "application/x-www-form-urlencoded"
                : "application/json"]: {
                schema: bodySchema,
                ...(endpoint.inputExample
                  ? { example: endpoint.inputExample }
                  : {}),
              },
            },
          },
        }
      : {}),
    responses,
  };
  const path = openPath(endpoint.path);
  paths[path] ??= {};
  paths[path]![endpoint.method.toLowerCase()] = operation;
  await emit(
    `docs/${route}.mdx`,
    `---\ntitle: ${JSON.stringify(endpoint.title)}\ndescription: ${JSON.stringify(endpoint.description.split("\n")[0])}\nplayground: simple\nopenapi: ${JSON.stringify(`/api-reference/openapi.json ${endpoint.method} ${path}`)}\n---\n\n${authText[endpoint.auth]}\n\n${endpoint.description}\n\n${endpoint.toolName ? `MCP clients can use [\`${endpoint.toolName}\`](/mcp-reference/${endpoint.toolName}) for this operation.\n\n` : ""}[Request conventions](/api-reference/overview) · [API keys](/api-keys) · [MCP connections](/mcp-connections)\n`,
  );
}
const version = JSON.parse(await readFile("package.json", "utf8"))
  .version as string;
const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Posted HTTP API",
    version,
    description:
      "All registered application, account, OAuth, MCP transport and health endpoints. Publishing and draft request schemas come from the shared runtime validators. Replace the example server with your installation. Documentation uses simple request examples and does not execute live publishing requests.",
  },
  servers: [{ url: "https://posted-api.example.com" }],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Personal or team Posted REST API key",
      },
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "posted_session",
        description:
          "Signed-in human browser session; mutation requests also need the exact UI Origin",
      },
      mcpBearer: {
        type: "http",
        scheme: "bearer",
        description:
          "OAuth bearer token issued for /mcp; REST API keys are not accepted",
      },
      oauthClientBasic: {
        type: "http",
        scheme: "basic",
        description:
          "Registered OAuth client authentication, when client_secret_basic is selected",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "requestId"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
            },
          },
        },
      },
    },
  },
};
await emit("docs/api-reference/openapi.json", JSON.stringify(openapi), "json");
await emit("docs/api-contract.json", JSON.stringify(snapshot), "json");
await emit(
  "docs/rest-reference.mdx",
  `---\ntitle: "Publishing API reference"\ndescription: "Find individual HTTP operations and illustrated MCP tools."\n---\n\nThe reference is now split into [HTTP operations](/api-reference/overview) and [MCP tools](/mcp-reference/list_providers).\n\nUse [API keys](/api-keys) for REST clients, or [OAuth MCP connections](/mcp-connections) for agents.\n`,
);
const site = JSON.parse(await readFile("docs/site.json", "utf8"));
const apiCategory = site.navigation.dropdowns.find(
  (item: { dropdown: string }) => item.dropdown === "API & MCP",
);
assert(apiCategory, "API & MCP navigation category is required");
for (const group of apiCategory.groups) {
  if (group.group === "MCP reference")
    group.pages = [...mcpNavigation].map(([group, pages]) => ({
      group,
      pages,
    }));
  if (group.group === "API Reference")
    group.pages = [
      "api-reference/overview",
      ...[...navigation].map(([group, pages]) => ({ group, pages })),
    ];
}
await emit("docs/site.json", JSON.stringify(site), "json");
try {
  for (const [path, body] of generated) {
    if (check)
      assert.equal(
        await readFile(path, "utf8"),
        body,
        `Generated reference differs: ${path}`,
      );
    else {
      await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      await writeFile(path, body);
    }
  }
  for (const directory of ["docs/api-reference", "docs/mcp-reference"])
    for (const name of await readdir(directory))
      if (name.endsWith(".mdx") && name !== "overview.mdx")
        assert(
          generated.has(`${directory}/${name}`),
          `Stale generated reference: ${directory}/${name}`,
        );
} finally {
  await closeDatabase();
}
console.log(
  `${check ? "Checked" : "Generated"} ${tools.length} MCP tool pages and ${endpoints.length} HTTP operation pages with complete route coverage.`,
);
