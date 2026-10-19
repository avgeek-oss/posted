import { createHmac } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { providerResponse, ProviderFailure } from "./network.js";

export const facebookVersion = "v26.0";
export const facebookScopes = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
];
const errorSchema = z.object({
  error: z.object({ code: z.number(), is_transient: z.boolean().optional() }),
});
export async function facebookJson<T>(
  path: string,
  token: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
  video = false,
): Promise<T> {
  const url = new URL(
    `https://${video ? "graph-video" : "graph"}.facebook.com/${facebookVersion}/${path}`,
  );
  const proof = createHmac("sha256", config().POSTED_FACEBOOK_CLIENT_SECRET)
    .update(token)
    .digest("hex");
  const body = options.body;
  if (body instanceof FormData || body instanceof URLSearchParams)
    body.set("appsecret_proof", proof);
  else url.searchParams.set("appsecret_proof", proof);
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await providerResponse(url, { ...options, headers });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ProviderFailure(response.status, true);
  }
  const error = errorSchema.safeParse(data);
  if (!response.ok || error.success) {
    const code = error.success ? error.data.error.code : undefined;
    const status =
      code === 190 || code === 102
        ? 401
        : code === 10 || code === 200
          ? 403
          : [4, 17, 32, 613].includes(code ?? -1)
            ? 429
            : error.success && error.data.error.is_transient
              ? 503
              : response.ok
                ? 400
                : response.status;
    const after = Number(response.headers.get("Retry-After"));
    throw new ProviderFailure(
      status,
      response.status === 408 ||
        response.status >= 500 ||
        status === 408 ||
        status >= 500,
      Number.isFinite(after) ? Math.max(0, after * 1000) : 0,
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ProviderFailure(response.status, true);
  return parsed.data;
}
