# Contributing to Posted

Use Node 24.16.0 and pnpm 11.5.3. Shared packages are public npm dependencies. Read AGENTS.md before changing product behavior.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm verify:production
```

Verification uses disposable PostgreSQL schemas and local private S3 buckets. The production gate creates its own containers and network, verifies installation and restore, and removes them. It never publishes a social post. Do not start the real publishing worker against browser fixtures.

Use the shared design system and Mintlify kit. Edit public guide sources in `docs/**/*.md`, register their metadata in `docs/pages.json` and organize navigation in `docs/site.json`. HTTP and MCP reference pages are generated from runtime routes and tool validators, with examples and supplemental account/OAuth descriptions in `tools/docs-reference-data.ts`. Run `pnpm docs:build` after changes; the generator rejects missing HTTP operations and invalid MCP examples. API/MCP navigation is generated as part of that build. Do not hand-edit the kit's generated snippets or styles. `pnpm docs:check` rejects drift. Only generated MDX is published; `docs/.mintignore` excludes the editable Markdown sources. `pnpm docs:validate` runs the pinned Mintlify CLI. Review desktop/mobile and light/dark rendering.

To refresh screenshots, run `pnpm docs:preview` in one terminal and `pnpm docs:capture` in another. The capture command uses the isolated documentation fixtures and saves lossless PNGs at twice the display dimensions listed in `docs/screenshots.json`. Keep the display dimensions unchanged and use the `@2x` files on the homepage and guide pages. `pnpm docs:check` verifies their resolution. To refresh a specific scene, pass its name, such as `pnpm docs:capture account-edit`.

Release preparation is local until publication is explicitly authorized. API, worker and UI versions must agree. Retain licensing and third-party notices, and never commit runtime configuration or credentials.
