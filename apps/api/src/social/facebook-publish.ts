import { z } from "zod";
import { firstPostLink } from "../../../../packages/contracts/src/links.js";
import { facebookJson } from "./facebook-api.js";
import type { DeliveryJob } from "../posts/queue.js";
import type { DeliveryMedia, PreparedPublication } from "./publish.js";
const idResponse = z.object({ id: z.string().regex(/^[0-9_]+$/) });
export async function prepareFacebook(
  job: DeliveryJob,
  media: DeliveryMedia[],
  token: string,
): Promise<PreparedPublication> {
  if (!/^[0-9]+$/.test(job.accountId))
    throw new Error("Facebook Page identity is invalid");
  const video = media.find((item) => item.kind === "video");
  if (video) {
    return {
      checkpoint: { mediaIds: [] },
      publish: async () => {
        const body = new FormData();
        body.set(
          "source",
          new Blob([new Uint8Array(video.bytes)], { type: "video/mp4" }),
          "video.mp4",
        );
        body.set("description", job.text);
        const result = await facebookJson(
          `${job.accountId}/videos`,
          token,
          idResponse,
          { method: "POST", body, signal: AbortSignal.timeout(180_000) },
          true,
        );
        return { id: result.id, url: `https://www.facebook.com/${result.id}` };
      },
    };
  }
  const ids: string[] = [];
  for (const image of media) {
    if (image.kind === "gif")
      throw new Error("Facebook GIFs must be prepared as videos");
    const body = new FormData();
    body.set(
      "source",
      new Blob([new Uint8Array(image.bytes)], { type: "image/jpeg" }),
      "image.jpg",
    );
    body.set("published", "false");
    if (image.alt) body.set("alt_text_custom", image.alt);
    const result = await facebookJson(
      `${job.accountId}/photos`,
      token,
      idResponse,
      { method: "POST", body },
    );
    ids.push(result.id);
  }
  return {
    checkpoint: { mediaIds: ids },
    publish: async () => {
      const body = new URLSearchParams({ message: job.text });
      if (ids.length)
        body.set(
          "attached_media",
          JSON.stringify(ids.map((id) => ({ media_fbid: id }))),
        );
      else {
        const link = firstPostLink(job.text);
        if (link) body.set("link", link);
      }
      const result = await facebookJson(
        `${job.accountId}/feed`,
        token,
        idResponse,
        { method: "POST", body },
      );
      return { id: result.id, url: `https://www.facebook.com/${result.id}` };
    },
  };
}
