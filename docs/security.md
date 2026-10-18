# Security

Posted restricts browser mutation origins and uses HTTP-only session cookies. It checks the current actor and role for browser, REST and MCP operations. PostgreSQL and worker ports should remain private.

Provider credentials and pending email payloads are encrypted with a key derived from `POSTED_SECRET`. The browser and client DTOs do not receive provider tokens or storage credentials. Signed media URLs expire and should still be treated as private links.

Posting is an external side effect. Version checks and content-bound request keys protect edits and repeated client requests. Worker leases and checkpoints protect preparation, and uncertainty at the publishing boundary is recorded rather than hidden by a blind retry.

## Report a vulnerability

Report a suspected vulnerability privately to the installation operator or through the repository's private security reporting channel when available. Do not include credentials, private recovery URLs, personal data or usable signed media URLs in public issues.
