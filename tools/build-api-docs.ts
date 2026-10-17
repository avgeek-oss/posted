import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { format } from "prettier";
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
const { tools } = await import("../apps/api/src/external/tools.js");
const { closeDatabase } = await import("../packages/database/src/index.js");
const check = process.argv.includes("--check");
const snapshot = tools.map((tool) => ({
  name: tool.name,
  method: tool.method,
  path: tool.path,
  description: tool.description,
  readOnly: tool.readOnly,
  administrator: Boolean(tool.admin),
  input: z.toJSONSchema(tool.input, { unrepresentable: "any" }),
}));
const json = await format(JSON.stringify(snapshot), { parser: "json" });
const reference = await format(
  `---
title: "REST and MCP publishing reference"
description: "Publishing contracts generated from Posted's MCP tool schemas and shared HTTP operations."
---

REST clients use a personal or team API key in the Authorization header. Browser sessions use cookies and exact-origin checks. MCP uses OAuth at the API origin's /mcp endpoint. Every operation checks the current actor's permission.

## Requests, versions and retries

Posting and saving a draft use a content-bound idempotencyKey. Reuse one key across retries of the same logical request; use a new key for an intentional new operation. A key reused for different content conflicts. Edits use the latest version; a stale version conflicts. Draft publication supplies draftSource with its ID and current version so conversion happens once.

A post's scheduledAt is an ISO 8601 timestamp with an offset. A future timestamp schedules delivery; an immediate timestamp requests immediate delivery. A created response records the request, not confirmed provider publication. Inspect deliveries afterward.

Text overrides are keyed by selected connection IDs. Media uploads return signed URLs; PUT bytes using the supplied headers, complete the upload, then poll status until ready. Post and draft bodies use mediaIds, and responses use media. Each root or additional post may supply mediaOverrides keyed by selected connection ID, with an ordered array of media IDs. Omit an account key to inherit master media; an empty array intentionally selects no media for that account. Responses resolve mediaOverrides into media objects. Text and media overrides are independent; resetting both removes both account keys.

## Operation catalogue

This catalogue is generated from the same tool definitions used by MCP. Path parameters are supplied separately in REST; for MCP they are part of the tool input. HTTP permissions still apply to API keys and browser sessions. A successful create usually returns 201; replay/update returns 200; processing media returns 202. Validation, authentication, permission, missing-record and conflict failures use 400, 401, 403, 404 and 409 respectively. Media failure uses 422.

| Tool | HTTP | Path | Access |
| --- | --- | --- | --- |
${snapshot.map((tool) => `| \`${tool.name}\` | ${tool.method} | \`${tool.path}\` | ${tool.administrator ? "Administrator" : tool.readOnly ? "Read" : "Write"} |`).join("\n")}

## Input schemas

Schemas below describe MCP inputs. Refinements such as team ownership, selected-account membership, provider content limits and version/idempotency rules are also enforced by the shared HTTP handlers.

${snapshot.map((tool) => `### ${tool.name}\n\n${tool.description}\n\n\`\`\`json\n${JSON.stringify(tool.input, null, 2)}\n\`\`\`\n`).join("\n")}
`,
  { parser: "mdx" },
);
try {
  for (const [path, body] of [
    ["docs/api-contract.json", json],
    ["docs/rest-reference.mdx", reference],
  ]) {
    if (check) {
      if ((await readFile(path, "utf8")) !== body)
        throw new Error(`API documentation differs: ${path}`);
    } else await writeFile(path, body);
  }
} finally {
  await closeDatabase();
}
console.log(
  `${check ? "Checked" : "Generated"} ${snapshot.length} shared REST/MCP operation schemas.`,
);
