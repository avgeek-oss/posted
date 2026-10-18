import { createHash, randomBytes, randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Provider } from "../packages/contracts/src/index.js";
import type { SocialOAuthProvider } from "../apps/api/src/social/routes.js";
import { sql } from "../packages/database/src/index.js";

const stateSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Grant = {
  provider: Provider;
  handle: string;
  accountId: string;
  challenge: string;
  expiresAt: number;
  code?: string;
};

export function previewOAuth(webUrl: string, apiUrl: string) {
  const grants = new Map<string, Grant>();
  async function pending(provider: Provider, rawState: string, userId: string) {
    const state = stateSchema.parse(rawState);
    const grant = grants.get(state);
    const [request] =
      await sql`SELECT state_hash FROM social_oauth_requests WHERE state_hash=${hash(state)} AND provider=${provider} AND user_id=${userId} AND consumed_at IS NULL AND expires_at>now()`;
    if (
      !request ||
      !grant ||
      grant.provider !== provider ||
      grant.expiresAt <= Date.now()
    )
      throw new HTTPException(400, {
        message:
          "This connection request expired or was already used. Start again",
      });
    return grant;
  }
  const providerClient: SocialOAuthProvider = {
    async pages() {
      return [
        {
          accountId: "123456",
          name: "Studio North",
          handle: "studio-north",
          avatarUrl: null,
        },
        {
          accountId: "789012",
          name: "Studio Journal",
          handle: "studio-journal",
          avatarUrl: null,
        },
      ];
    },
    async authorize(provider, handle, state, verifier) {
      for (const [key, grant] of grants)
        if (grant.expiresAt <= Date.now()) grants.delete(key);
      const id = randomUUID();
      const accountHandle = handle ?? `alex_${id.slice(0, 8)}`;
      grants.set(state, {
        provider,
        handle: accountHandle,
        accountId: `preview-${provider}-${accountHandle.toLowerCase()}`,
        challenge: hash(verifier),
        expiresAt: Date.now() + 600_000,
      });
      const url = new URL("/connections/authorize", webUrl);
      url.search = new URLSearchParams({ provider, state }).toString();
      return url.toString();
    },
    async exchange(provider, query, verifier) {
      const state = stateSchema.parse(query.get("state"));
      const grant = grants.get(state);
      const code = z.string().min(1).parse(query.get("code"));
      if (
        !grant ||
        grant.provider !== provider ||
        grant.expiresAt <= Date.now() ||
        grant.code !== code ||
        grant.challenge !== hash(verifier)
      )
        throw new HTTPException(400, {
          message: "This authorization code is invalid or expired. Start again",
        });
      grants.delete(state);
      return {
        profile: {
          accountId: grant.accountId,
          name: "Alex Morgan",
          handle: grant.handle,
          avatarUrl: null,
        },
        credential: {
          accessToken: "disposable-preview-not-a-provider-token",
          expiresAt: Date.now() + 3_600_000,
          issuedAt: Date.now(),
        },
      };
    },
  };
  return {
    providerClient,
    async authorization(provider: Provider, state: string, userId: string) {
      const grant = await pending(provider, state, userId);
      return { provider, name: "Alex Morgan", handle: grant.handle };
    },
    async decide(
      provider: Provider,
      state: string,
      userId: string,
      decision: "approve" | "deny",
    ) {
      const grant = await pending(provider, state, userId);
      const url = new URL(`/api/social/callback/${provider}`, apiUrl);
      url.searchParams.set("state", state);
      if (decision === "approve") {
        grant.code = randomBytes(32).toString("base64url");
        url.searchParams.set("code", grant.code);
      } else {
        grants.delete(state);
        url.searchParams.set("error", "access_denied");
      }
      return { authorizationUrl: url.toString() };
    },
  };
}
