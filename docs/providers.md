# Provider application setup

Create provider applications under your own accounts. Use the installation's public API origin in callback settings. Complete configuration enables that provider in Add connection; local tests cannot grant production permissions or paid-plan access.

| Provider | Required environment                                         | Requested scope or client metadata                                                       |
| -------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| X        | `POSTED_X_CLIENT_ID`, `POSTED_X_CLIENT_SECRET`               | `tweet.read tweet.write users.read offline.access media.write`                           |
| LinkedIn | `POSTED_LINKEDIN_CLIENT_ID`, `POSTED_LINKEDIN_CLIENT_SECRET` | `openid profile w_member_social`; `POSTED_LINKEDIN_API_VERSION` selects the API version. |
| Threads  | `POSTED_THREADS_CLIENT_ID`, `POSTED_THREADS_CLIENT_SECRET`   | `threads_basic,threads_content_publish`                                                  |
| Bluesky  | `POSTED_BLUESKY_CLIENT_ID`, `POSTED_BLUESKY_PRIVATE_KEY_JWK` | Official OAuth with PKCE, DPoP and private-key client authentication.                    |

For X, LinkedIn and Threads, register these exact callbacks after replacing the example API origin:

```text
https://posted-api.example.com/api/social/callback/x
https://posted-api.example.com/api/social/callback/linkedin
https://posted-api.example.com/api/social/callback/threads
```

For Bluesky, set the client ID to `https://posted-api.example.com/social/bluesky/client-metadata.json`. Supply an EC P-256 private signing JWK with a key ID. Posted serves client metadata and public keys at `/social/bluesky/client-metadata.json` and `/social/bluesky/jwks.json`; it never serves the private JWK.

## Configure the hosted installation in Towbar

The Posted API and Posted Worker manifests declare the provider keys under `secrets.runtime`. In Towbar, open each service, select **production**, and fill its runtime secret values. Use identical values in both services. Posted UI does not receive provider credentials.

| Provider | Runtime key                      | Value                                                               |
| -------- | -------------------------------- | ------------------------------------------------------------------- |
| X        | `POSTED_X_CLIENT_ID`             | OAuth 2.0 client ID from your X application.                        |
| X        | `POSTED_X_CLIENT_SECRET`         | Matching OAuth 2.0 client secret.                                   |
| LinkedIn | `POSTED_LINKEDIN_CLIENT_ID`      | Client ID from your LinkedIn application.                           |
| LinkedIn | `POSTED_LINKEDIN_CLIENT_SECRET`  | Matching client secret.                                             |
| LinkedIn | `POSTED_LINKEDIN_API_VERSION`    | `202609`, the version used by Posted 0.2.0.                         |
| Threads  | `POSTED_THREADS_CLIENT_ID`       | Client ID for your Threads application.                             |
| Threads  | `POSTED_THREADS_CLIENT_SECRET`   | Matching Threads client secret.                                     |
| Bluesky  | `POSTED_BLUESKY_CLIENT_ID`       | `https://posted-api.avgeek.ltd/social/bluesky/client-metadata.json` |
| Bluesky  | `POSTED_BLUESKY_PRIVATE_KEY_JWK` | A private EC P-256 JWK as one JSON string.                          |

Register these exact callback URLs for this installation:

```text
https://posted-api.avgeek.ltd/api/social/callback/x
https://posted-api.avgeek.ltd/api/social/callback/linkedin
https://posted-api.avgeek.ltd/api/social/callback/threads
```

Towbar requires a value for every declared key before deployment. To leave a provider disabled, remove its key declarations from both manifests before syncing; for LinkedIn, also remove its API-version declaration. Posted requires each provider's credentials together and rejects partial configuration.

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

Saving values in Towbar does not update running containers. After saving both services, deploy the API and then the worker. An administrator can then open **Connections → Add connection**, choose an enabled provider and complete its OAuth flow. Connections belong to the team. Media publishing also needs the separate [private storage configuration](/storage).

Consult the provider's current registration and approval instructions: [X OAuth](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [LinkedIn member sharing](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin), [Threads](https://developers.facebook.com/docs/threads/) and [Bluesky OAuth](https://atproto.com/specs/oauth).

After configuration, an administrator connects a test account and confirms its granted permissions. Verify one authorized text, image and video delivery for each provider you intend to use, and inspect provider-side results. Treat provider approval and a real publishing smoke test as separate from Posted's local contract tests.
