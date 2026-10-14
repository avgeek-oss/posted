# Posted engineering guidance

Posted is a team-owned social publishing application. Implement the complete v1 scope in docs/v1-requirements.md; a scaffold, mock provider or passing narrow test is not completion.

- Use Node 24, pnpm, strict TypeScript, PostgreSQL and the published @avgeek-oss/design-system. Preserve the shared authentication, installation-secret, account/team settings, notification feedback and MCP consent compositions. Do not invent app-specific replacements for existing primitives.
- Connected social accounts belong to the team, never the connecting user's personal settings. Enable providers only from complete operator configuration. Use official OAuth for X, LinkedIn, Bluesky and Threads, with state/PKCE, secure token storage and server-enforced permissions.
- MCP consent uses the shared user-selected Read-only, Write and Administrator form. Revoke human-owned MCP grants on every role change. Permissions apply equally to browser, REST and MCP.
- Use durable database scheduling with per-account delivery state. Reuse one idempotency key across retries of a logical posting request. Do not retry uncertain external publishing blindly. Distinguish a request's partial success from full success.
- Adapt images on the server at delivery time, stripping metadata and meeting each provider's supported format, dimensions and byte limits. Keep original uploads private. Use signed short-lived media URLs only when a provider requires fetching media.
- Use semantic theme tokens, Inter, Hugeicons and shared tables on desktop/mobile. Verify the real responsive routes and interactions in light/dark themes. Feedback belongs in shared toasts.
- Keep credentials, tokens and setup secrets out of Git, artifacts and logs. Verification uses isolated disposable local databases and objects. Do not publish a repository, release, deploy or send real social posts without the user's authorization.
- Maintain requirements and evidence in docs/v1-requirements.md. Require strict typechecking, lint, meaningful permission/concurrency/OAuth tests, real PostgreSQL tests, production builds and container verification before claiming completion.
