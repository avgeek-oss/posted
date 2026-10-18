# Changelog

## Unreleased

### Configuration changes

LinkedIn API version is fixed at `202609`. The `POSTED_LINKEDIN_API_VERSION` environment setting has been removed. Future LinkedIn API version changes will be listed as breaking changes.

## 0.1.0 (release candidate)

Initial Posted implementation with team-owned social connections, a shared/per-account composer, private image and video media, durable drafts and scheduling, and per-account publishing results.

Includes the shared installation-secret setup, verified first administrator, passkeys, account/team settings, REST keys and OAuth MCP consent. API, worker and UI use one version, with PostgreSQL and optional private storage and SMTP.

See [GitHub Releases](https://github.com/avgeek-oss/posted/releases) for product changes, published versions and images.
