# Security

Posted restricts browser mutation origins and uses HTTP-only session cookies. It checks the current actor and role for browser, REST and MCP operations. PostgreSQL and worker ports should remain private.

Provider credentials and pending email payloads are encrypted with a key derived from `POSTED_SECRET`. The browser and client DTOs do not receive provider tokens or storage credentials. Signed media URLs expire and should still be treated as private links.

Posting is an external side effect. Version checks and content-bound request keys protect edits and repeated client requests. Worker leases and checkpoints protect preparation, and uncertainty at the publishing boundary is recorded rather than hidden by a blind retry.

## Accounts and team access

Setup requires the installation secret from the API startup log. The first administrator is verified automatically and can continue directly to sign-in. There is no public self-registration that bypasses team invitations.

| Role          | Access                                                                            |
| ------------- | --------------------------------------------------------------------------------- |
| Administrator | Manage team members, connections and team settings, and compose or inspect posts. |
| Member        | Compose, save drafts, upload media, schedule and inspect delivery results.        |
| Viewer        | Inspect team data without writing or managing connections.                        |

Administrators manage invitations and roles in Team Settings. Account Settings contains profile, date/time preferences, password, sessions, passkeys, personal API keys and MCP connections. Passkeys act as a second factor. Keep a recovery method available before changing account security.

SMTP enables account-email workflows. Invitations and password recovery use short-lived proofs, and password or role changes revoke affected client grants. A human-owned MCP connection cannot exceed the current role. Role changes revoke it and require approval again.

For account recovery when email is unavailable, see [Backup and recovery](/backup#recover-an-administrator-account).

## Report a vulnerability

Report a suspected vulnerability privately to the installation operator or through the repository's private security reporting channel when available. Do not include credentials, private recovery URLs, personal data or usable signed media URLs in public issues.
