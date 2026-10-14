import { serve } from "@hono/node-server";
import { config } from "../apps/api/src/config.js";
import { closeDatabase } from "../packages/database/src/index.js";
import { createPreviewApi } from "./preview-api.js";

const preview = await createPreviewApi();
const server = serve(
  { fetch: preview.fetch, port: config().PORT, hostname: "127.0.0.1" },
  () => console.log("Posted disposable preview API ready"),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () =>
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    }),
  );

let preparingMedia = false;
const { prepareNextMedia } = await import("../apps/worker/src/media.js");
setInterval(async () => {
  if (preparingMedia) return;
  preparingMedia = true;
  try {
    await prepareNextMedia();
  } catch {
    console.error("Preview media processing could not access its queue");
  } finally {
    preparingMedia = false;
  }
}, 1000).unref();
