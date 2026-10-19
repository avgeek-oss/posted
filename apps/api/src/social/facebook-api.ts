import { createHmac } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { metaJson, metaVersion } from "./meta-api.js";

export const facebookScopes = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
];
export async function facebookJson<T>(
  path: string,
  token: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
  video = false,
): Promise<T> {
  const url = new URL(
    `https://${video ? "graph-video" : "graph"}.facebook.com/${metaVersion}/${path}`,
  );
  const proof = createHmac("sha256", config().POSTED_FACEBOOK_CLIENT_SECRET)
    .update(token)
    .digest("hex");
  const body = options.body;
  if (body instanceof FormData || body instanceof URLSearchParams)
    body.set("appsecret_proof", proof);
  else url.searchParams.set("appsecret_proof", proof);
  return metaJson(url, token, schema, options);
}
