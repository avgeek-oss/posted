# Posted

A team-owned social media scheduler for X, LinkedIn, Bluesky and Threads.

Posted uses the same shared authentication, settings and MCP consent components as Towbar, Mill, Rootset and Vitalog. Social accounts connect to the team and can be shared by its members within their current permissions.

Read the documentation at [posted.cc](https://posted.cc). The source uses the published shared design system and includes PostgreSQL, private-storage, OAuth, MCP, image/video and worker-concurrency tests. See the [release sign-off](docs/release-signoff.md) for the published release evidence and deployment status. Provider application approval and production credentials remain installation prerequisites.

Use the [installation guide](docs/installation.md) to run version-matched API, worker and UI images with external or bundled PostgreSQL. The [development guide](docs/development.md) describes source builds, local previews and disposable verification services. Public source builds require no npm registry credential.

## Towbar deployment

`towbar.yml` and `.towbar/` define the hosted production deployment using the published v0.2.0 image digests. See [installation with Towbar](docs/installation.md#deploy-with-towbar) for runtime values, deployment order and moving an existing installation. Forks must use their own registered server and domains.

## Architecture

- `apps/api`: identity, team administration, OAuth callbacks and publishing requests.
- `apps/worker`: durable scheduling and provider-specific media preparation/delivery.
- `apps/web`: composer, provider previews, connections, scheduled posts, history and shared settings.
- `packages/database`: PostgreSQL migrations and transaction context.
- `packages/contracts`: shared request/response contracts.

UI and API use separate origins. PostgreSQL owns schedules and delivery state; storage keeps uploaded originals private. Provider secrets are environment configuration and never browser data.

## Attribution

Authentication, team administration and application shell integration are adapted from the Apache-2.0 licensed Avgeek OSS Mill application. Shared UI is provided by `@avgeek-oss/design-system`.
