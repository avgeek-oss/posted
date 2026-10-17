# Upgrades

Choose a published GitHub release and read its release notes and `posted-images.json`. Verify the image references, platform and version. Take a [tested backup](/backup) before changing an installation.

<Steps>
  <Step title="Stop writes and deliveries">Use a maintenance window. Stop API and worker and review in-flight or uncertain deliveries. Keep users from editing during the snapshot.</Step>
  <Step title="Back up the installation">Retain PostgreSQL, the stable secret, private configuration and media. Record the old version and image references.</Step>
  <Step title="Use one new version">Update `POSTED_VERSION` in the private environment. API, worker and UI must all use it. Pull the new images.</Step>
  <Step title="Start and verify">Start Compose. The API migrates before readiness and the worker waits for API health. Check all three containers, public origins, sign-in, an existing draft and its media.</Step>
</Steps>

```sh
docker compose pull
docker compose up -d
docker compose ps
```

Use the same Compose overlays as the original installation. If a migration or startup fails, keep the worker stopped and diagnose the error. Restore a tested snapshot and matching version if recovery requires rollback. Do not mutate migration checksums or reset delivery state to make the upgrade appear successful.

## Upgrading from 0.1.0 to 0.2.0

This release adds migrations `009_post_sequences.sql` and `010_account_media.sql`. Existing posts, drafts and attachments become the first post in a sequence; account media continues to inherit the master unless customized. Back up the database and private media before upgrading all three images together.

The API adds optional `additionalPosts` and `mediaOverrides` fields. Existing single-post requests continue to work, including replay of their original request keys. An omitted account media override inherits the master; an explicit empty list means no media for that account. See the [REST reference](/rest-reference) for the generated request schemas.

After the release images are available, Towbar installations should pin API, worker and UI to the matching digests from `posted-images.json`. Keep deployment manual, retain the existing datastore and stable secret, deploy the API migration before the worker, then update the UI. Check an existing draft, its media, account previews and scheduled delivery state before reopening writes. A source or manifest PR does not itself deploy the application.
