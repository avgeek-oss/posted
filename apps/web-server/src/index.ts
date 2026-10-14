import { resolve } from "node:path";
import { createWebServer, webConfiguration } from "./server.js";

const configuration = webConfiguration();
const server = createWebServer(
  process.env.POSTED_WEB_DIR ?? resolve("apps/web/dist"),
  configuration,
);
server.listen(configuration.port, "0.0.0.0", () =>
  console.log(`Posted UI ready (port ${configuration.port})`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => server.close(() => process.exit(0)));
