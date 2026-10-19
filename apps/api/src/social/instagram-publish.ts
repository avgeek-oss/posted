import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { instagramJson } from "./instagram.js";
import { ProviderFailure } from "./network.js";
import type { DeliveryJob } from "../posts/queue.js";
import type { DeliveryMedia, PreparedPublication } from "./publish.js";
const idResponse = z.object({ id: z.string().regex(/^[0-9]+$/) });
async function container(
  accountId: string,
  token: string,
  fields: Record<string, string>,
) {
  return instagramJson(`${accountId}/media`, token, idResponse, {
    method: "POST",
    body: new URLSearchParams(fields),
  });
}
export async function waitForInstagramContainer(
  id: string,
  token: string,
  wait = () => delay(60_000),
) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const result = await instagramJson(
      `${id}?fields=status_code`,
      token,
      z.object({
        status_code: z.enum([
          "FINISHED",
          "IN_PROGRESS",
          "ERROR",
          "EXPIRED",
          "PUBLISHED",
        ]),
      }),
    );
    if (result.status_code === "FINISHED") return;
    if (result.status_code !== "IN_PROGRESS")
      throw new Error("Instagram could not prepare this media container");
    if (attempt < 5) await wait();
  }
  throw new Error("Instagram media processing timed out before publishing");
}
export async function prepareInstagram(
  job: DeliveryJob,
  media: DeliveryMedia[],
  token: string,
): Promise<PreparedPublication> {
  if (!/^[0-9]+$/.test(job.accountId))
    throw new Error("Instagram account identity is invalid");
  if (!media.length || media.length > 10)
    throw new Error("Add one video or up to ten photos for Instagram");
  if (
    media.some(
      (m) => !m.url || !["https:", "http:"].includes(new URL(m.url).protocol),
    )
  )
    throw new Error("Instagram requires temporary media URLs");
  if (media.some((m) => m.kind === "gif"))
    throw new Error("Instagram GIFs must be prepared as videos");
  if (media.length > 1 && media.some((m) => m.kind === "video"))
    throw new Error("Choose photos or one video for Instagram");
  const quota = await instagramJson(
    `${job.accountId}/content_publishing_limit?fields=quota_usage,config`,
    token,
    z.object({
      data: z
        .array(
          z.object({
            quota_usage: z.number().int().nonnegative(),
            config: z.object({ quota_total: z.number().int().positive() }),
          }),
        )
        .length(1),
    }),
  );
  if (quota.data[0]!.quota_usage >= quota.data[0]!.config.quota_total)
    throw new ProviderFailure(429, false, 60_000);
  const children: string[] = [];
  for (const image of media.length > 1 ? media : []) {
    const child = await container(job.accountId, token, {
      image_url: image.url!,
      is_carousel_item: "true",
      ...(image.alt ? { alt_text: image.alt } : {}),
    });
    await waitForInstagramContainer(child.id, token);
    children.push(child.id);
  }
  const first = media[0]!;
  const prepared = await container(job.accountId, token, {
    caption: job.text,
    ...(children.length
      ? { media_type: "CAROUSEL", children: children.join(",") }
      : first.kind === "video"
        ? { media_type: "REELS", video_url: first.url!, share_to_feed: "true" }
        : {
            image_url: first.url!,
            ...(first.alt ? { alt_text: first.alt } : {}),
          }),
  });
  await waitForInstagramContainer(prepared.id, token);
  return {
    checkpoint: { containerId: prepared.id },
    publish: async () => {
      const result = await instagramJson(
        `${job.accountId}/media_publish`,
        token,
        idResponse,
        {
          method: "POST",
          body: new URLSearchParams({ creation_id: prepared.id }),
        },
      );
      let url = "";
      try {
        const published = await instagramJson(
          `${result.id}?fields=permalink`,
          token,
          z.object({
            permalink: z.url().regex(/^https:\/\/(?:www\.)?instagram\.com\//),
          }),
        );
        url = published.permalink;
      } catch {
        /* A confirmed media ID proves success even if the permalink lookup fails. */
      }
      return { id: result.id, url };
    },
  };
}
