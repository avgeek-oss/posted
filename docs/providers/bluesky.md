# Bluesky

Connect your account by entering your Bluesky handle and approving access on Bluesky. You do not need to register a developer application or copy an account password into Posted.

## Connect an account

<Steps>
  <Step title="Configure the provider">Add the required environment variables below to your Posted installation.</Step>
  <Step title="Authorize the account">A team administrator opens **Connections → Add connection**, chooses **Bluesky**, enters their handle (for example, name.bsky.social), and continues to Bluesky to sign in and approve access.</Step>
  <Step title="Choose it in the composer">After returning to Posted, confirm that the account is Connected. Select it through **Choose Accounts**, review its preview and customize its text or media if needed.</Step>
</Steps>

Accounts belong to the team. Connecting the same provider account again refreshes the existing connection. Members can compose for connected accounts; only administrators can add or disconnect them.

## Required environment variables

Add these values to both the API and worker services, then restart them to apply the configuration.

```dotenv title="Environment variables"
POSTED_BLUESKY_CLIENT_ID={{POSTED_API_URL}}/social/bluesky/client-metadata.json
POSTED_BLUESKY_PRIVATE_KEY_JWK=YOUR_PRIVATE_JWK_JSON
```

## Application configuration

Posted serves your OAuth client metadata at:

```text title="Client metadata URL"
{{POSTED_API_URL}}/social/bluesky/client-metadata.json
```

The metadata includes this callback URL:

```text title="Callback URL"
{{POSTED_API_URL}}/api/social/callback/bluesky
```

Public signing keys are served at:

```text title="Public signing keys URL"
{{POSTED_API_URL}}/social/bluesky/jwks.json
```

The metadata and public keys must be publicly reachable over HTTPS. The private signing key stays on your server.

## Generate a signing key

For Bluesky, generate a private signing key in a private operator directory, outside the repository:

```sh
node --input-type=module <<'JS'
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = { ...privateKey.export({ format: "jwk" }), kid: randomUUID(), alg: "ES256", use: "sig" };
writeFileSync("posted-bluesky-private.jwk", JSON.stringify(jwk), { mode: 0o600, flag: "wx" });
JS
```

Copy that file's JSON into `POSTED_BLUESKY_PRIVATE_KEY_JWK` in both services. Keep the file private and retain the same signing key across deployments.

Posted requests `atproto`, `transition:generic`.

Posted uses [Bluesky OAuth](https://atproto.com/guides/about-oauth). Bluesky discovers your installation through its public client metadata URL; there is no separate developer application registration or approval step.

## Limits enforced by Posted

| Content        | Posted behavior                    |
| -------------- | ---------------------------------- |
| Text           | 300 grapheme clusters per post     |
| Attachments    | Up to 4 images **or** one video    |
| Video duration | 3–180 seconds                      |
| Sequence       | Linked replies after the root post |

These are Posted’s current delivery limits. Use [list_providers](/mcp-reference/list_providers) or the provider API endpoint to inspect the running installation’s capabilities. Uploaded originals are prepared for the provider at delivery time; provider account permissions and quotas still apply.

## Posts, media and threads

Uploaded GIFs are converted to MP4 for publishing. Use one GIF without other attachments in the same post. See [Images, GIFs and videos](/media) for upload limits and preparation.

Enter your Bluesky handle when beginning the connection, for example name.bsky.social. The provider flow discovers the account’s server. In a thread, each reply retains the first publication as its root and the preceding publication as its parent.

Each post has independent text and attachment order. Account-specific edits affect only that account and post. **Reset to master** restores text and media inheritance after confirmation. Image or video publishing requires [S3 source](/configuration#s3-source).

```mermaid
flowchart LR
  draft["Write shared content"] --> account["Review Bluesky account"]
  account --> ready["Validate text and media"]
  ready --> publish["Confirm publishing or schedule"]
  publish --> outcome["Read per-post delivery results"]
```

Read [Compose a post](/composer) for single posts and [Compose threads](/threads) for insertion, ordering, reply links and failure handling.

## Reconnect and troubleshoot

If the account needs reauthentication, an administrator repeats the official authorization flow. If Bluesky is missing from Add connection, ask the operator to check the complete provider configuration and deploy the saved runtime values. If authorization fails, check that the client metadata and public signing keys URLs open over HTTPS and that the metadata uses your API origin for the callback URL.

Inspect [Publish history](/deliveries) for each account's result. A confirmed provider publication stays published if another account fails. An **Uncertain** result needs provider-side inspection before another posting request. Disconnecting prevents later use of the account and does not remove existing provider posts.
