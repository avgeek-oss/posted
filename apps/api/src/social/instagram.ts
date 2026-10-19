import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { metaJson, metaVersion } from "./meta-api.js";
export const instagramScopes = [
  "instagram_business_basic",
  "instagram_business_content_publish",
];
export function instagramJson<T>(
  path: string,
  token: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
) {
  return metaJson(
    new URL(`https://graph.instagram.com/${metaVersion}/${path}`),
    token,
    schema,
    options,
  );
}
// Meta's direct-login endpoints return either an object or a one-item data envelope.
export function instagramSingle<T>(schema: z.ZodType<T>) {
  return z.preprocess((value) => {
    if (value && typeof value === "object" && "data" in value) {
      return Object.keys(value).length === 1 &&
        Array.isArray(value.data) &&
        value.data.length === 1
        ? value.data[0]
        : null;
    }
    return value;
  }, schema);
}
export function instagramProfile(token: string) {
  return instagramJson(
    "me?fields=id,user_id,username,name,account_type,profile_picture_url",
    token,
    instagramSingle(
      z.object({
        id: z.string().regex(/^[0-9]+$/),
        user_id: z.string().regex(/^[0-9]+$/),
        username: z.string().min(1),
        name: z.string().optional(),
        account_type: z.string(),
        profile_picture_url: z.url().optional(),
      }),
    ),
  ).then((data) => {
    if (
      !["BUSINESS", "MEDIA_CREATOR"].includes(data.account_type.toUpperCase())
    )
      throw new HTTPException(400, {
        message: "Connect an Instagram Business or Creator account",
      });
    return {
      accountId: data.user_id,
      subjectId: data.id,
      name: data.name || data.username,
      handle: data.username,
      avatarUrl: data.profile_picture_url ?? null,
    };
  });
}
