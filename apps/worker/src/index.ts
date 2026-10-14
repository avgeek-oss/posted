import { setTimeout as delay } from "node:timers/promises";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { validateConfiguration } from "../../api/src/config.js";
import { closeDatabase, sql } from "../../../packages/database/src/index.js";
import { prepareNextMedia } from "./media.js";
import { deliverNext } from "./delivery.js";
import { postedVersion } from "../../api/src/version.js";

const configuration = validateConfiguration();
let stopping = false;
const health = new Hono();
health.get("/health/live", (c) =>
  c.json(
    { status: stopping ? "stopping" : "ok", version: postedVersion },
    stopping ? 503 : 200,
  ),
);
health.get("/health/ready", async (c) => {
  if (stopping) return c.json({ status: "stopping" }, 503);
  try {
    await sql`SELECT id FROM post_deliveries LIMIT 1`;
    return c.json({ status: "ready", version: postedVersion });
  } catch {
    return c.json({ status: "unavailable" }, 503);
  }
});
const server = serve({
  fetch: health.fetch,
  port: process.env.PORT ? configuration.PORT : 4343,
  hostname: "0.0.0.0",
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stopping = true;
  });
try {
  while (!stopping) {
    try {
      if (await prepareNextMedia()) continue;
      if (!(await deliverNext())) await delay(1000);
    } catch {
      console.error(
        "Posted worker could not access its queue; retrying shortly",
      );
      await delay(3000);
    }
  }
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await closeDatabase();
}
