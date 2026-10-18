import {
  NodeOAuthClient,
  JoseKey,
  type NodeSavedSession,
  type NodeSavedState,
} from "@atproto/oauth-client-node";
import { safeFetchWrap } from "@atproto-labs/fetch-node";
import { config } from "../config.js";
import {
  sql,
  withDatabaseTransaction,
} from "../../../../packages/database/src/index.js";
import { seal, unseal } from "./secrets.js";
import { callbackUrl } from "./tokens.js";

let instance: Promise<NodeOAuthClient> | undefined;
export function blueskyClient() {
  return (instance ??= createClient());
}
async function createClient() {
  const cfg = config();
  const key = await JoseKey.fromImportable(
    cfg.POSTED_BLUESKY_PRIVATE_KEY_JWK,
    "posted-1",
  );
  return new NodeOAuthClient({
    clientMetadata: {
      client_id: cfg.POSTED_BLUESKY_CLIENT_ID,
      client_name: "Posted",
      redirect_uris: [callbackUrl("bluesky") as `https://${string}`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "atproto transition:generic",
      application_type: "web",
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "ES256",
      dpop_bound_access_tokens: true,
      jwks_uri: `${cfg.POSTED_API_URL.replace(/\/$/, "")}/social/bluesky/jwks.json`,
    },
    keyset: [key],
    fetch: safeFetchWrap({ allowImplicitRedirect: true }),
    stateStore: {
      async set(key: string, value: NodeSavedState) {
        await sql`INSERT INTO bluesky_oauth_state(key,value,expires_at) VALUES(${key},${seal(value, `bluesky-state:${key}`)},now()+interval '10 minutes') ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at`;
      },
      async get(key: string) {
        const [row] = await sql<
          { value: string }[]
        >`SELECT value FROM bluesky_oauth_state WHERE key=${key} AND expires_at>now()`;
        return row
          ? (unseal(row.value, `bluesky-state:${key}`) as NodeSavedState)
          : undefined;
      },
      async del(key: string) {
        await sql`DELETE FROM bluesky_oauth_state WHERE key=${key}`;
      },
    },
    sessionStore: {
      async set(key: string, value: NodeSavedSession) {
        await sql`INSERT INTO bluesky_oauth_sessions(key,value) VALUES(${key},${seal(value, `bluesky-session:${key}`)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
      },
      async get(key: string) {
        const [row] = await sql<
          { value: string }[]
        >`SELECT value FROM bluesky_oauth_sessions WHERE key=${key}`;
        return row
          ? (unseal(row.value, `bluesky-session:${key}`) as NodeSavedSession)
          : undefined;
      },
      async del(key: string) {
        await sql`DELETE FROM bluesky_oauth_sessions WHERE key=${key}`;
        await sql`UPDATE social_connections SET state='reauthentication_required' WHERE provider='bluesky' AND account_id=${key} AND state='connected'`;
      },
    },
    requestLock: async (key, fn) =>
      withDatabaseTransaction(async () => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bluesky:${key}`},0))`;
        return fn();
      }),
  });
}
