# Configuration

Configuration belongs in the operator's private environment, not in a client bundle or image. The API and worker share the database, stable secret, public origins, provider settings and private storage credentials. The UI receives only the public API and storage origins.

| Setting             | Purpose                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`      | PostgreSQL URI. Use a hostname reachable from the containers.                        |
| `POSTED_SECRET`     | At least 32 random characters; protects sessions and encrypted provider credentials. |
| `POSTED_WEB_URL`    | Exact public HTTPS UI origin, without a path or trailing configuration data.         |
| `POSTED_API_URL`    | Separate public HTTPS API origin used for API, MCP and provider callbacks.           |
| `POSTED_VERSION`    | One published version for API, worker and UI.                                        |
| `POSTGRES_PASSWORD` | Required only for bundled PostgreSQL; use a random alphanumeric value.               |

Loopback HTTP is allowed for local development. Public origins require HTTPS. Do not use the Mintlify documentation domain as the application API origin: `posted.cc` hosts documentation, while your installation has its own UI and API origins.

Provider settings are listed in [provider setup](/providers). A provider is enabled only when all its required values are present; partial configuration fails startup. The LinkedIn API version defaults to `202609` and must be kept within the provider's supported versions.

## Towbar

The manifests require the core runtime settings. Social provider credentials are optional; add a complete provider group to both API and Worker runtime secrets when enabling that provider. Towbar passes configured runtime secrets even when they are not listed as required in the manifest.

## SMTP

Set `POSTED_SMTP_HOST` and `POSTED_SMTP_FROM` together. Supply `POSTED_SMTP_USER` and `POSTED_SMTP_PASSWORD` together when authentication is required. Port defaults to 587; `POSTED_SMTP_SECURE=false` uses STARTTLS for a remote SMTP server, while `true` uses direct TLS, usually on 465. Use a sender such as `Posted <posted@example.com>`.

Verify the sender domain and its SPF, DKIM and DMARC configuration with your email service. A display name and application theme do not guarantee delivery outside spam folders. Posted sends branded account emails through the API's durable email outbox, not the publishing worker.

## Storage

Configure the endpoint, region, bucket and credentials as described in [storage](/storage). Leave the complete storage group blank to disable uploads. The worker includes FFmpeg and has a 256 MiB writable `/tmp`; its root filesystem stays read-only.
