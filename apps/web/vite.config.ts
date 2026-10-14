import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  THEME_STORAGE_KEY,
  themeBootstrapScript,
} from "@avgeek-oss/design-system/lib/theme";
import { frontendNotices } from "../../tools/frontend-notices.mjs";
const initialThemeScript = `(() => {
  try {
    if (localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}) === null) {
      const previous = localStorage.getItem("posted:theme");
      if (previous === "light" || previous === "dark" || previous === "system")
        localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)}, previous);
    }
  } catch {}
})();${themeBootstrapScript}`;
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "posted-development-api-origin",
      configureServer(server) {
        server.middlewares.use("/runtime-config.js", (_request, response) => {
          response.setHeader(
            "Content-Type",
            "application/javascript; charset=utf-8",
          );
          response.setHeader("Cache-Control", "no-store");
          response.end(
            `window.__POSTED_RUNTIME_CONFIG__=Object.freeze(${JSON.stringify({ apiOrigin: process.env.POSTED_API_URL ?? "http://localhost:4341" })});`,
          );
        });
      },
    },
    {
      name: "posted-theme-bootstrap",
      configureServer(server) {
        server.middlewares.use("/theme-bootstrap.js", (_request, response) => {
          response.setHeader(
            "Content-Type",
            "application/javascript; charset=utf-8",
          );
          response.end(initialThemeScript);
        });
      },
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "theme-bootstrap.js",
          source: initialThemeScript,
        });
      },
      transformIndexHtml: () => [
        {
          tag: "script",
          injectTo: "head-prepend",
          attrs: { src: "/theme-bootstrap.js" },
        },
      ],
    },
    frontendNotices(),
  ],
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "@avgeek-oss/design-system",
      "@heroui/react",
      "react-aria",
      "react-aria-components",
      "@react-aria/utils",
      "@react-aria/ssr",
    ],
  },
  server: {
    port: 4342,
  },
  build: { outDir: "dist" },
});
