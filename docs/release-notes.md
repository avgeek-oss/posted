# Release notes

## 0.1.0

- Team-owned X, LinkedIn, Bluesky and Threads connections using official OAuth.
- A compact composer with shared text, per-account overrides, previews and account error badges.
- Durable drafts, confirmation before immediate posting, schedule editing and per-account delivery details.
- Private image and video media, ordering and provider-specific preparation.
- Shared installation-secret setup, verified bootstrap administrator, account/team settings, passkeys, API keys and OAuth MCP consent.
- Version-matched API, worker and UI images, PostgreSQL migrations and optional private storage/SMTP.

Use the [GitHub Releases page](https://github.com/avgeek-oss/posted/releases) to confirm which version has actually been published. Published releases include immutable image references in `posted-images.json`. Provider application approval and production account verification remain installation requirements.

Existing prelaunch source checkouts must back up before applying migrations. Media contracts use `media` and `mediaIds` and `/api/media`; older image-only endpoints are not compatibility aliases. Previously edited drafts and delivery sets whose editor was not recorded show Not recorded until a successful save.
