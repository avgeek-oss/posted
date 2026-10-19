import {
  linkedInPages,
  linkedInPageRoutes,
  saveLinkedInPageGrant,
} from "./linkedin-pages.js";
import {
  PROVIDERS,
  type LinkedInPage,
} from "../../../../packages/contracts/src/index.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { Agent } from "@atproto/api";
import {
  OAuthResolverError,
  OAuthResponseError,
} from "@atproto/oauth-client-node";
import {
  sql,
  withDatabaseTransaction,
} from "../../../../packages/database/src/index.js";
import { requireHuman, requireRole, type Env } from "../http.js";
import { withMutationAuthority } from "../middleware.js";
import { checkThreadsAuthorization } from "./threads-callbacks.js";
import { config } from "../config.js";
import { enabledProviders } from "./capabilities.js";
import { seal, unseal } from "./secrets.js";
import {
  callbackUrl,
  clientCredentials,
  credentialsSchema,
  exchangeCode,
  accountProfile,
} from "./tokens.js";
import { blueskyClient } from "./bluesky.js";
import { blueskyLoginSchema } from "./bluesky-input.js";
import type { Provider } from "../../../../packages/contracts/src/index.js";

export type SocialOAuthProvider = {
  pages?: (
    accessToken: string,
    accountIds?: string[],
  ) => Promise<LinkedInPage[]>;
  authorize: (
    provider: Provider,
    handle: string | undefined,
    state: string,
    verifier: string,
  ) => Promise<string>;
  exchange: (
    provider: Provider,
    query: URLSearchParams,
    verifier: string,
  ) => Promise<{
    profile: {
      accountId: string;
      name: string;
      handle: string;
      avatarUrl: string | null;
    };
    credential: unknown;
  }>;
};
const providerSchema = z.enum(PROVIDERS);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function createSocialRoutes(providerClient?: SocialOAuthProvider) {
  const socialRoutes = new Hono<Env>();
  socialRoutes.route("/", linkedInPageRoutes(providerClient?.pages));
  socialRoutes.post("/api/social/connect/:provider", async (c) => {
    const actor = requireRole(c, "admin");
    const provider = providerSchema.parse(c.req.param("provider"));
    if (provider === "linkedin-pages") requireHuman(c);
    if (
      !providerClient &&
      !enabledProviders(process.env).some((p) => p.id === provider)
    )
      throw new HTTPException(400, {
        message:
          "Ask your installation operator to configure this provider first",
      });
    const input = z
      .object({ handle: z.string().trim().max(2048).optional() })
      .strict()
      .parse(await c.req.json());
    const login =
      provider === "bluesky"
        ? blueskyLoginSchema.parse(input.handle ?? "")
        : input.handle;
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    await sql`INSERT INTO social_oauth_requests(state_hash,provider,workspace_id,user_id,encrypted_verifier,expires_at) VALUES(${hash(state)},${provider},(SELECT id FROM workspace),${actor.userId},${seal(verifier, `social-oauth:${hash(state)}`)},now()+interval '10 minutes')`;
    let url: URL;
    if (providerClient) {
      url = new URL(
        await providerClient.authorize(provider, login, state, verifier),
      );
    } else if (provider === "bluesky") {
      try {
        url = await (
          await blueskyClient()
        ).authorize(z.string().parse(login), {
          state,
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        if (error instanceof OAuthResolverError)
          throw new HTTPException(400, {
            message:
              "Bluesky could not find this account or server. Check the handle or use your server's HTTPS URL.",
          });
        if (error instanceof OAuthResponseError)
          throw new HTTPException(502, {
            message:
              error.error === "invalid_client_metadata" ||
              error.error === "invalid_client"
                ? "Bluesky rejected this installation's OAuth configuration. Ask your operator to check the client metadata and signing key."
                : "Bluesky could not start the connection. Try again shortly.",
          });
        throw error;
      }
    } else {
      const client = clientCredentials(provider);
      url = new URL(
        provider === "x"
          ? "https://x.com/i/oauth2/authorize"
          : provider === "linkedin" || provider === "linkedin-pages"
            ? "https://www.linkedin.com/oauth/v2/authorization"
            : "https://www.threads.net/oauth/authorize",
      );
      url.search = new URLSearchParams({
        client_id: client.id,
        redirect_uri: callbackUrl(provider),
        response_type: "code",
        state,
        scope:
          provider === "x"
            ? "tweet.read tweet.write users.read offline.access media.write"
            : provider === "linkedin-pages"
              ? "rw_organization_admin w_organization_social"
              : provider === "linkedin"
                ? "openid profile w_member_social"
                : "threads_basic,threads_content_publish",
      }).toString();
      if (provider === "x") {
        url.searchParams.set(
          "code_challenge",
          createHash("sha256").update(verifier).digest("base64url"),
        );
        url.searchParams.set("code_challenge_method", "S256");
      }
    }
    return c.json({ authorizationUrl: url.toString() });
  });

  socialRoutes.get("/api/social/callback/:provider", async (c) => {
    const actor = requireRole(c, "admin");
    const provider = providerSchema.parse(c.req.param("provider"));
    if (provider === "linkedin-pages") requireHuman(c);
    let state = c.req.query("state");
    if (provider === "bluesky" && !providerClient) {
      const sdkState = z.string().min(1).max(512).parse(state);
      const [saved] = await sql<{ value: string }[]>`
      SELECT value FROM bluesky_oauth_state
      WHERE key=${sdkState} AND expires_at>now()
    `;
      if (!saved)
        throw new HTTPException(400, {
          message:
            "This connection request expired or was already used. Start again",
        });
      state = z
        .object({ appState: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
        .parse(unseal(saved.value, `bluesky-state:${sdkState}`)).appState;
    }
    const rawState = z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .parse(state);
    const [pending] = await sql<{ encryptedVerifier: string }[]>`
    SELECT encrypted_verifier FROM social_oauth_requests
    WHERE state_hash=${hash(rawState)} AND provider=${provider}
      AND user_id=${actor.userId} AND expires_at>now() AND consumed_at IS NULL
  `;
    if (!pending)
      throw new HTTPException(400, {
        message:
          "This connection request expired or belongs to another user. Start again",
      });
    let profile: {
      accountId: string;
      name: string;
      handle: string;
      avatarUrl: string | null;
    };
    let credential: unknown;
    if (c.req.query("error")) {
      await withMutationAuthority(c, async () => {
        await sql`UPDATE social_oauth_requests SET consumed_at=now() WHERE state_hash=${hash(rawState)} AND provider=${provider} AND user_id=${actor.userId} AND consumed_at IS NULL`;
      });
      return c.redirect(
        `${config().POSTED_WEB_URL.replace(/\/$/, "")}/connections?connection=denied`,
      );
    }
    if (provider === "linkedin-pages") {
      const verifier = z
        .string()
        .parse(
          unseal(pending.encryptedVerifier, `social-oauth:${hash(rawState)}`),
        );
      const token = providerClient
        ? credentialsSchema.parse(
            (
              await providerClient.exchange(
                provider,
                new URL(c.req.url).searchParams,
                verifier,
              )
            ).credential,
          )
        : await exchangeCode(
            provider,
            z.string().min(1).max(4096).parse(c.req.query("code")),
            verifier,
          );
      const pages = await (providerClient?.pages ?? linkedInPages)(
        token.accessToken,
      );
      const selection = await withMutationAuthority(c, () =>
        saveLinkedInPageGrant(actor.userId, hash(rawState), token, pages),
      );
      return c.redirect(
        `${config().POSTED_WEB_URL.replace(/\/$/, "")}/connections?linkedinPages=${selection}`,
      );
    }
    if (providerClient) {
      const verifier = z
        .string()
        .parse(
          unseal(pending.encryptedVerifier, `social-oauth:${hash(rawState)}`),
        );
      ({ profile, credential } = await providerClient.exchange(
        provider,
        new URL(c.req.url).searchParams,
        verifier,
      ));
    } else if (provider === "bluesky") {
      const result = await (
        await blueskyClient()
      ).callback(new URL(c.req.url).searchParams);
      const agent = new Agent(result.session);
      const { data } = await agent.getProfile({ actor: result.session.did });
      profile = {
        accountId: result.session.did,
        name: data.displayName || data.handle,
        handle: data.handle,
        avatarUrl: data.avatar ?? null,
      };
      credential = { did: result.session.did };
    } else {
      const code = z.string().min(1).max(4096).parse(c.req.query("code"));
      const verifier = z
        .string()
        .parse(
          unseal(pending.encryptedVerifier, `social-oauth:${hash(rawState)}`),
        );
      const token = await exchangeCode(provider, code, verifier);
      profile = await accountProfile(provider, token.accessToken);
      credential = token;
    }
    await withDatabaseTransaction(async () => {
      const [pending] = await sql<
        { workspaceId: string; createdAt: Date }[]
      >`UPDATE social_oauth_requests SET consumed_at=now() WHERE state_hash=${hash(rawState)} AND provider=${provider} AND user_id=${actor.userId} AND expires_at>now() AND consumed_at IS NULL RETURNING workspace_id,created_at`;
      if (!pending)
        throw new HTTPException(400, {
          message:
            "This connection request expired or was already used. Start again",
        });
      if (provider === "threads")
        await checkThreadsAuthorization(profile.accountId, pending.createdAt);
      const [existing] = await sql<
        { id: string }[]
      >`SELECT id FROM social_connections WHERE workspace_id=${pending.workspaceId} AND provider=${provider} AND account_id=${profile.accountId}`;
      const id = existing?.id ?? randomUUID();
      const encrypted = seal(credential, `social-connection:${id}`);
      await sql`INSERT INTO social_connections(id,workspace_id,provider,account_id,name,handle,avatar_url,encrypted_credentials,connected_by) VALUES(${id},${pending.workspaceId},${provider},${profile.accountId},${profile.name},${profile.handle},${profile.avatarUrl},${encrypted},${actor.userId}) ON CONFLICT(workspace_id,provider,account_id) DO UPDATE SET name=excluded.name,handle=excluded.handle,avatar_url=excluded.avatar_url,encrypted_credentials=excluded.encrypted_credentials,state='connected',connected_by=excluded.connected_by,updated_at=now()`;
    });
    return c.redirect(
      `${config().POSTED_WEB_URL.replace(/\/$/, "")}/connections?connection=connected`,
    );
  });
  socialRoutes.get("/social/bluesky/client-metadata.json", async (c) => {
    if (!config().POSTED_BLUESKY_CLIENT_ID) throw new HTTPException(404);
    return c.json((await blueskyClient()).clientMetadata);
  });
  socialRoutes.get("/social/bluesky/jwks.json", async (c) => {
    if (!config().POSTED_BLUESKY_CLIENT_ID) throw new HTTPException(404);
    return c.json((await blueskyClient()).jwks);
  });
  return socialRoutes;
}
export const socialRoutes = createSocialRoutes();
