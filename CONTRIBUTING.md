# Contributing to Posted

Use Node 24.16.0 and pnpm 11.5.3. Shared packages are public npm dependencies. Read AGENTS.md and the [development guide](docs/development.md) before changing product behavior.

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm verify:production
```

Verification uses disposable PostgreSQL schemas and local private S3 buckets. The production gate creates its own containers and network, verifies installation and restore, and removes them. It never publishes a social post. Do not start the real publishing worker against browser fixtures.

Use the shared design system and Mintlify kit. Edit public guide sources in `docs/*.md` and navigation in `docs/site.json`, then run `pnpm docs:build`. Do not hand-edit the kit's generated snippets or styles. `pnpm docs:check` rejects drift. `pnpm docs:validate` runs the pinned Mintlify CLI. Review desktop/mobile and light/dark rendering.

Release preparation is local until publication is explicitly authorized. API, worker and UI versions must agree. Retain licensing and third-party notices, and never commit runtime configuration or credentials.
