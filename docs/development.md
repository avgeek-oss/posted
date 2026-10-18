# Development and verification

Use Node 24.16.0 and pnpm 11.5.3. Shared packages install from public npm without registry credentials:

```sh
pnpm install --frozen-lockfile
```

Development uses `.env` with loopback UI/API origins, a disposable PostgreSQL database and a unique `POSTED_SECRET`. Run the API, UI and worker in separate terminals:

```sh
pnpm dev
pnpm dev:web
pnpm dev:worker
```

The worker publishes due posts using real connected credentials. Use a separate test database for fixture accounts, and never start a real delivery worker against the disposable browser-preview fixtures.

## Integration services

The test suite creates a separate random PostgreSQL schema per test file and removes that schema afterwards. Its default development database is `postgres://posted:posted-local-verification@127.0.0.1:55490/posted`. Override `DATABASE_URL` for your disposable local database.

The S3 integration tests create and remove a random bucket in a local RustFS instance. Their fixed credentials are disposable test credentials, not production secrets. Run the fixture services:

```sh
docker run -d --name posted-v1-postgres -p 127.0.0.1:55490:5432 \
  -e POSTGRES_DB=posted -e POSTGRES_USER=posted \
  -e POSTGRES_PASSWORD=posted-local-verification postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24

docker run -d --name posted-v1-storage -p 127.0.0.1:55491:9000 \
  --tmpfs /data:rw,uid=10001,gid=10001 --tmpfs /logs:rw,uid=10001,gid=10001 \
  -e RUSTFS_ACCESS_KEY=posted-local-fixture \
  -e RUSTFS_SECRET_KEY=posted-disposable-storage-passphrase \
  -e RUSTFS_CONSOLE_ENABLE=false rustfs/rustfs@sha256:1803faef57627e2d9c2e7d89d655d712ddded5389040054987163043fecb6a3c /data
```

Wait for PostgreSQL readiness and RustFS health before running `pnpm verify`. `POSTED_TEST_STORAGE_ENDPOINT` may override the storage endpoint, but tests refuse non-loopback storage. RustFS fixture configuration follows its [official Docker guide](https://github.com/rustfs/docs.rustfs.com/blob/main/content/en/installation/container/docker.md).

## Browser preview fixtures

Use a disposable loopback installation with the API and UI origins set to `http://localhost:4341` and `http://localhost:4342`. After configuring `.env` and starting the integration services, prepare private preview storage and sample data:

```sh
node --import tsx tools/local-storage.ts
node --env-file=.env --import tsx tools/local-preview.ts
node --env-file=.env --import tsx tools/local-preview-drafts.ts
```

The storage helper creates the private `posted-preview` bucket, local CORS and a sample image in `artifacts/posted-preview.png`. Configure the preview's S3 variables to use that bucket and the disposable storage credentials above. The account helper rejects production and non-loopback installations. It creates a verified preview administrator, fake provider connections and display-only API-key/MCP records whose hashes cannot authenticate requests. Sign in with `local@avgeek.ltd` and `test123`. The short password is assigned only by this guarded local fixture; normal setup and password-change validation still apply.

The draft helper adds four editable samples to **Pending Drafts** using the normal authenticated upload and draft APIs:

| Sample            | Posts | Accounts                   | Media                                                   |
| ----------------- | ----- | -------------------------- | ------------------------------------------------------- |
| Studio update     | 1     | All four providers         | Three-image carousel                                    |
| Behind the scenes | 1     | Bluesky, LinkedIn, Threads | Four-second MP4                                         |
| Field notes       | 3     | Bluesky, Threads, X        | Landscape, portrait and square images across the thread |
| Shipping notes    | 4     | Bluesky, LinkedIn, Threads | Images, a video reply and a text-only final post        |

Several posts include account-specific copy for testing customization and reset confirmation. Images are generated locally in landscape, portrait and square formats, with alt text; FFmpeg generates and normalizes the video. Media remains in private loopback storage. Stable draft IDs make reruns additive: existing samples and any user edits are preserved. The helper requires the `Posted Preview` workspace, all four fixture accounts, a loopback S3 endpoint and the `posted-preview` bucket. It creates drafts only, with no scheduling or publishing.

Start `pnpm dev:preview` and `pnpm dev:web` for browser review. Add connection uses the production UI and copy. Continue opens a local provider authorization page; Authorize and Cancel return through the production callback, including actor-bound expiring state, one-use authorization codes, verifier checks and connection persistence/reconnection. Only the external provider transport is simulated. The preview API enables all four providers and creates disposable accounts without external sign-in or publishing access. It keeps normal session, administrator and origin checks, rejects production, non-loopback origins and any workspace other than Posted Preview, and does not run an email or delivery worker. Production and ordinary `pnpm dev` still require configured provider OAuth credentials. Preview provider credentials are deliberately unusable; do not run `pnpm dev:worker` against this database. Worker/container verification uses a separate empty database.

## What the tests prove

- First-administrator setup requires the installation secret and does not send verification email.
- Roles govern scheduling, uploads and account management.
- Concurrent requests produce one group and one delivery per selected account; content mismatches conflict. Partial success preserves successful provider results without republishing either account.
- Scheduled edits use version guards and independently replayable request keys.
- Competing workers cannot share a claim. Expired preparation can recover; uncertain publishing never blindly requeues.
- Provider contract tests use strict request stubs, with no fallback to real provider networking.
- The official MCP SDK exercises consent, PKCE, user-selected scopes, request keys and role-change revocation through Posted's HTTP handlers.
- Real S3 operations cover private access, signed uploads, immutable originals, verified bytes and bounded reads.
- Sharp tests cover all four providers' output formats, byte limits, dimensions, orientation and metadata removal.

Rendered desktop/mobile, light/dark review and container health are additional gates. Local tests do not prove provider application approval or real social publication.

## Video media

Install FFmpeg and ffprobe on the development host (`brew install ffmpeg` on macOS). The worker image supplies FFmpeg from Alpine. The existing worker prepares private video uploads before claiming delivery jobs. Give it a writable `/tmp` of at least 256 MiB; Compose sets this explicitly while retaining the read-only root filesystem. Upload completion returns 202 while a video is processing. Poll `/api/media/{id}/status` for ready metadata or a failed response. Originals remain private and immutable; the worker produces a metadata-stripped H.264/AAC MP4 with inline playback support.

The browser preview processes media through the same preparation function, but continues to leave the delivery queue untouched. Do not start the real publishing worker against browser fixtures. Existing image tables and associations are renamed by migration 007 without replacing their records or stored objects. Post/draft contracts use `media` and `mediaIds`; upload routes use `/api/media`. MCP supports reserving/completing private uploads and checking their status and preview.

## Documentation and release preparation

Edit the guide sources in `docs/**/*.md`, page metadata in `docs/pages.json` and category/group navigation in `docs/site.json`. Run `pnpm docs:build` to generate Mintlify pages with the shared docs kit. The reference generator reads registered HTTP routes and MCP tool validators; `tools/docs-reference-data.ts` supplies fictional examples and supplemental account/OAuth descriptions. Every HTTP operation must have one reference page, and every MCP example must pass its runtime input schema. Generated API/MCP navigation is updated during the build. `pnpm docs:check` checks generated consistency, schemas, links and screenshot dimensions; `pnpm docs:validate` runs the pinned Mintlify build and broken-link checks. Review `pnpm docs:dev` on desktop and mobile.

`pnpm docs:preview` starts an isolated fixture schema and bucket at `http://127.0.0.1:4392` with its API on port 4391 for documentation captures. Its separate loopback hostname keeps its browser session cookies apart from the main localhost preview. It uses sample accounts and media, processes media only and removes its owned data when stopped. It does not reset an existing preview installation.

Run `pnpm verify` and `pnpm verify:production` before requesting release review. The production gate creates disposable containers, verifies setup, private video, scheduling, branded account email and database/media restoration, then removes its containers and private files. Native AMD64 and ARM64 CI are required before publication. The release workflow validates the exact source commit, scans images, checks anonymous GHCR access and writes an immutable three-image manifest. Check [GitHub Actions](https://github.com/avgeek-oss/posted/actions) for verification results and [GitHub Releases](https://github.com/avgeek-oss/posted/releases) for published image manifests and installation assets.
