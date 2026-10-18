import { z } from "zod";
import type { Provider } from "../../../../packages/contracts/src/index.js";
import { config } from "../config.js";
import { bearer, providerJson, ProviderFailure } from "./network.js";

export const credentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  issuedAt: z.number(),
});
export type SocialCredentials = z.infer<typeof credentialsSchema>;
export const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});
export function credentials(
  value: z.infer<typeof tokenResponse>,
): SocialCredentials {
  return {
    accessToken: value.access_token,
    ...(value.refresh_token ? { refreshToken: value.refresh_token } : {}),
    ...(value.expires_in
      ? { expiresAt: Date.now() + value.expires_in * 1000 }
      : {}),
    issuedAt: Date.now(),
  };
}
export function callbackUrl(provider: Provider) {
  return `${config().POSTED_API_URL.replace(/\/$/, "")}/api/social/callback/${provider}`;
}
export function clientCredentials(provider: Exclude<Provider, "bluesky">) {
  const value = config();
  switch (provider) {
    case "x":
      return {
        id: value.POSTED_X_CLIENT_ID,
        secret: value.POSTED_X_CLIENT_SECRET,
      };
    case "linkedin":
      return {
        id: value.POSTED_LINKEDIN_CLIENT_ID,
        secret: value.POSTED_LINKEDIN_CLIENT_SECRET,
      };
    case "linkedin-pages":
      return {
        id: value.POSTED_LINKEDIN_PAGES_CLIENT_ID,
        secret: value.POSTED_LINKEDIN_PAGES_CLIENT_SECRET,
      };
    case "threads":
      return {
        id: value.POSTED_THREADS_CLIENT_ID,
        secret: value.POSTED_THREADS_CLIENT_SECRET,
      };
  }
}
export async function exchangeCode(
  provider: Exclude<Provider, "bluesky">,
  code: string,
  verifier: string,
) {
  const client = clientCredentials(provider);
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(provider),
    client_id: client.id,
  });
  let url: string;
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  switch (provider) {
    case "x":
      url = "https://api.x.com/2/oauth2/token";
      form.set("code_verifier", verifier);
      headers.Authorization = `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString("base64")}`;
      break;
    case "linkedin":
    case "linkedin-pages":
      url = "https://www.linkedin.com/oauth/v2/accessToken";
      form.set("client_secret", client.secret);
      break;
    case "threads":
      url = "https://graph.threads.net/oauth/access_token";
      form.set("client_secret", client.secret);
      break;
  }
  const value = await providerJson(url, tokenResponse, {
    method: "POST",
    headers,
    body: form,
  });
  if (provider !== "threads") return credentials(value);
  const extended = new URL("https://graph.threads.net/access_token");
  extended.search = new URLSearchParams({
    grant_type: "th_exchange_token",
    client_secret: client.secret,
    access_token: value.access_token,
  }).toString();
  return credentials(await providerJson(extended, tokenResponse));
}
export async function refreshCredentials(
  provider: Exclude<Provider, "bluesky">,
  current: SocialCredentials,
): Promise<SocialCredentials> {
  if (!current.expiresAt || current.expiresAt > Date.now() + 5 * 60_000)
    return current;
  const client = clientCredentials(provider);
  if (provider === "threads") {
    if (current.issuedAt > Date.now() - 24 * 60 * 60_000)
      throw new ProviderFailure(401);
    const url = new URL("https://graph.threads.net/refresh_access_token");
    url.search = new URLSearchParams({
      grant_type: "th_refresh_token",
      access_token: current.accessToken,
    }).toString();
    return credentials(await refreshToken(url));
  }
  if (!current.refreshToken) throw new ProviderFailure(401);
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
    client_id: client.id,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (provider === "x")
    headers.Authorization = `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString("base64")}`;
  else form.set("client_secret", client.secret);
  const value = await refreshToken(
    provider === "x"
      ? "https://api.x.com/2/oauth2/token"
      : "https://www.linkedin.com/oauth/v2/accessToken",
    { method: "POST", headers, body: form },
  );
  return {
    ...credentials(value),
    refreshToken: value.refresh_token ?? current.refreshToken,
  };
}

async function refreshToken(url: string | URL, options?: RequestInit) {
  try {
    return await providerJson(url, tokenResponse, options);
  } catch (error) {
    // OAuth endpoints reject expired or revoked refresh grants with HTTP 400.
    if (error instanceof ProviderFailure && error.status === 400)
      throw new ProviderFailure(401);
    throw error;
  }
}
export async function accountProfile(
  provider: Exclude<Provider, "bluesky" | "linkedin-pages">,
  accessToken: string,
) {
  const options = { headers: bearer(accessToken) };
  if (provider === "x") {
    const { data } = await providerJson(
      "https://api.x.com/2/users/me?user.fields=profile_image_url",
      z.object({
        data: z.object({
          id: z.string(),
          name: z.string(),
          username: z.string(),
          profile_image_url: z.string().optional(),
        }),
      }),
      options,
    );
    return {
      accountId: data.id,
      name: data.name,
      handle: data.username,
      avatarUrl: data.profile_image_url ?? null,
    };
  }
  if (provider === "linkedin") {
    const data = await providerJson(
      "https://api.linkedin.com/v2/userinfo",
      z.object({
        sub: z.string(),
        name: z.string(),
        picture: z.string().optional(),
      }),
      options,
    );
    return {
      accountId: data.sub,
      name: data.name,
      handle: data.name,
      avatarUrl: data.picture ?? null,
    };
  }
  const data = await providerJson(
    "https://graph.threads.net/v1.0/me?fields=id,username,name,threads_profile_picture_url",
    z.object({
      id: z.string(),
      username: z.string(),
      name: z.string().optional(),
      threads_profile_picture_url: z.string().optional(),
    }),
    options,
  );
  return {
    accountId: data.id,
    name: data.name || data.username,
    handle: data.username,
    avatarUrl: data.threads_profile_picture_url ?? null,
  };
}
