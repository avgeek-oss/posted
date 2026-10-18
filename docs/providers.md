# Provider application setup

Create provider applications under your own accounts. Use the installation's public API origin in callback settings. Complete configuration enables that provider in Add connection; local tests cannot grant production permissions or paid-plan access.

Use your configured `POSTED_API_URL`, including `https://`, wherever a URL contains `{{POSTED_API_URL}}`.

## Required environment variables

Add the variables for each provider you want to enable to both the API and worker services.

<CodeGroup>

```dotenv title="X"
POSTED_X_CLIENT_ID=YOUR_X_CLIENT_ID
POSTED_X_CLIENT_SECRET=YOUR_X_CLIENT_SECRET
```

```dotenv title="LinkedIn"
POSTED_LINKEDIN_CLIENT_ID=YOUR_LINKEDIN_CLIENT_ID
POSTED_LINKEDIN_CLIENT_SECRET=YOUR_LINKEDIN_CLIENT_SECRET
```

```dotenv title="Threads"
POSTED_THREADS_CLIENT_ID=YOUR_THREADS_CLIENT_ID
POSTED_THREADS_CLIENT_SECRET=YOUR_THREADS_CLIENT_SECRET
```

```dotenv title="Bluesky"
POSTED_BLUESKY_CLIENT_ID={{POSTED_API_URL}}/social/bluesky/client-metadata.json
POSTED_BLUESKY_PRIVATE_KEY_JWK=YOUR_PRIVATE_JWK_JSON
```

</CodeGroup>

Use the [X](/providers/x), [Threads](/providers/threads), [LinkedIn](/providers/linkedin) or [Bluesky](/providers/bluesky) guide for callback URLs and application permissions.

## Configure in Towbar

Uncomment the provider keys under `secrets.runtime` in the [Towbar deployment files](/installation/towbar#1-add-the-deployment-files), then sync your deployment repository. In Towbar, open each service, select **production**, and enter its runtime secret values. Use the same values in both services. The UI does not need provider credentials.

Leave unused provider groups commented out. Supply both required values for each provider you enable.

## Generate a Bluesky signing key

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

Saving values in Towbar does not update running containers. After saving both services, deploy the API and then the worker. An administrator can then open **Connections → Add connection**, choose an enabled provider and complete its OAuth flow. Connections belong to the team. Media publishing also needs an [S3 source](/configuration#s3-source).

Consult the provider's current registration and approval instructions: [X OAuth](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [LinkedIn member sharing](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin), [Threads](https://developers.facebook.com/docs/threads/) and [Bluesky OAuth](https://atproto.com/specs/oauth).

After configuration, an administrator connects a test account and confirms its granted permissions. Verify one authorized text, image and video delivery for each provider you intend to use, and inspect provider-side results. Treat provider approval and a real publishing smoke test as separate from Posted's local contract tests.
