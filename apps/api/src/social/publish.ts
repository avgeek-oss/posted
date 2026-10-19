import { prepareFacebook } from "./facebook-publish.js";
import { linkedinHeaders } from "./linkedin-pages.js";
import { firstPostLink } from "../../../../packages/contracts/src/links.js";
import { getLinkPreview } from "../links/preview.js";
import { z } from "zod";
import { Agent, RichText, XRPCError } from "@atproto/api";
import { isValidTid } from "@atproto/syntax";
import { setTimeout as delay } from "node:timers/promises";
import type { DeliveryJob } from "../posts/queue.js";
import {
  bearer,
  jsonBody,
  providerJson,
  providerRequest,
  ProviderFailure,
  checkProviderResponse,
} from "./network.js";
import { blueskyClient } from "./bluesky.js";

export type DeliveryImage = {
  kind?: "image";
  id: string;
  bytes: Buffer;
  width: number;
  height: number;
  alt: string;
  url?: string;
};
export type DeliveryVideo = Omit<DeliveryImage, "kind"> & {
  kind: "video";
  durationSeconds: number;
};
export type DeliveryGif = Omit<DeliveryImage, "kind"> & { kind: "gif" };
export type DeliveryMedia = DeliveryImage | DeliveryVideo | DeliveryGif;
export type Publication = { id: string; url: string; cid?: string };
export type PreparedPublication = {
  checkpoint:
    | { mediaIds: string[] }
    | { media: { id: string; altText?: string }[] }
    | { containerId: string }
    | { rkey: string };
  publish: () => Promise<Publication>;
};
const idResponse = z.object({ id: z.string().min(1) });
export async function preparePublication(
  job: DeliveryJob,
  images: DeliveryMedia[],
  accessToken?: string,
): Promise<PreparedPublication> {
  if (job.provider === "bluesky") {
    try {
      return await prepareBluesky(job, images);
    } catch (error) {
      throw blueskyFailure(error);
    }
  }
  if (!accessToken)
    throw new Error("This connection needs renewed authorization");
  switch (job.provider) {
    case "x":
      return prepareX(job, images, accessToken);
    case "linkedin":
    case "linkedin-pages":
      return prepareLinkedIn(job, images, accessToken);
    case "facebook-pages":
      return prepareFacebook(job, images, accessToken);
    case "threads":
      return prepareThreads(job, images, accessToken);
  }
}
async function prepareX(
  job: DeliveryJob,
  images: DeliveryMedia[],
  token: string,
): Promise<PreparedPublication> {
  const ids: string[] = [];
  for (const image of images) {
    if (image.kind === "video" || image.kind === "gif") {
      ids.push(await uploadXMotion(image, token));
      continue;
    }
    const { data } = await providerJson(
      "https://api.x.com/2/media/upload",
      z.object({ data: idResponse }),
      {
        ...jsonBody({
          media: image.bytes.toString("base64"),
          media_category: "tweet_image",
          media_type: "image/jpeg",
        }),
        headers: { ...bearer(token), "Content-Type": "application/json" },
      },
    );
    ids.push(data.id);
  }
  const payload = {
    ...(job.text ? { text: job.text } : {}),
    ...(job.replyTo ? { reply: { in_reply_to_tweet_id: job.replyTo.id } } : {}),
    ...(ids.length ? { media: { media_ids: ids } } : {}),
  };
  return {
    checkpoint: { mediaIds: ids },
    publish: async () => {
      const { data } = await providerJson(
        "https://api.x.com/2/tweets",
        z.object({ data: idResponse }),
        {
          ...jsonBody(payload),
          headers: { ...bearer(token), "Content-Type": "application/json" },
        },
      );
      return { id: data.id, url: `https://x.com/i/status/${data.id}` };
    },
  };
}
function trustedLinkedInUpload(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !["linkedin.com", "licdn.com"].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  )
    throw new Error("LinkedIn returned an unexpected upload destination");
  return url;
}
async function prepareLinkedIn(
  job: DeliveryJob,
  images: DeliveryMedia[],
  token: string,
): Promise<PreparedPublication> {
  const owner = `urn:li:${job.provider === "linkedin-pages" ? "organization" : "person"}:${job.accountId}`;
  const media: { id: string; altText?: string }[] = [];
  for (const image of images) {
    if (image.kind === "video") {
      media.push({ id: await uploadLinkedInVideo(image, owner, token) });
      continue;
    }
    media.push({
      id: await uploadLinkedInImage(
        image.bytes,
        image.kind === "gif" ? "image/gif" : "image/jpeg",
        owner,
        token,
      ),
      altText: image.alt,
    });
  }
  const link = !images.length ? firstPostLink(job.text) : null;
  const preview = link ? await getLinkPreview(link) : null;
  const thumbnail = preview?.image
    ? await uploadLinkedInImage(
        Buffer.from(preview.image.data, "base64"),
        "image/jpeg",
        owner,
        token,
      )
    : undefined;
  if (thumbnail) media.push({ id: thumbnail });
  const content = preview
    ? {
        article: {
          source: preview.url,
          title: preview.title,
          description: preview.description,
          ...(thumbnail ? { thumbnail } : {}),
        },
      }
    : media.length === 1
      ? { media: media[0] }
      : media.length > 1
        ? { multiImage: { images: media } }
        : undefined;
  const payload = {
    author: owner,
    commentary: job.text,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    ...(content ? { content } : {}),
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  return {
    checkpoint: { media },
    publish: async () => {
      const response = await providerRequest(
        "https://api.linkedin.com/rest/posts",
        {
          ...jsonBody(payload),
          headers: {
            ...linkedinHeaders(token),
            "Content-Type": "application/json",
          },
        },
      );
      const id = response.headers.get("x-restli-id");
      if (!id) throw new ProviderFailure(response.status, true);
      return {
        id,
        url: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/`,
      };
    },
  };
}
async function uploadLinkedInImage(
  bytes: Buffer,
  contentType: string,
  owner: string,
  token: string,
) {
  const { value } = await providerJson(
    "https://api.linkedin.com/rest/images?action=initializeUpload",
    z.object({
      value: z.object({
        uploadUrl: z.string().url(),
        image: z.string().startsWith("urn:li:image:"),
      }),
    }),
    {
      ...jsonBody({ initializeUploadRequest: { owner } }),
      headers: {
        ...linkedinHeaders(token),
        "Content-Type": "application/json",
      },
    },
  );
  await providerRequest(trustedLinkedInUpload(value.uploadUrl), {
    method: "PUT",
    headers: { ...bearer(token), "Content-Type": contentType },
    body: new Uint8Array(bytes),
  });
  return value.image;
}
async function threadsContainer(
  accountId: string,
  fields: Record<string, string>,
  token: string,
) {
  return providerJson(
    `https://graph.threads.net/v1.0/${encodeURIComponent(accountId)}/threads`,
    idResponse,
    {
      method: "POST",
      headers: {
        ...bearer(token),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields),
    },
  );
}
async function waitForThreadsContainer(id: string, token: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await providerJson(
      `https://graph.threads.net/v1.0/${encodeURIComponent(id)}?fields=id,status`,
      z.object({
        status: z.enum([
          "FINISHED",
          "IN_PROGRESS",
          "ERROR",
          "EXPIRED",
          "PUBLISHED",
        ]),
      }),
      { headers: bearer(token) },
    );
    if (value.status === "FINISHED") return;
    if (value.status !== "IN_PROGRESS")
      throw new Error("Threads could not prepare this media container");
    await delay(2000);
  }
  throw new Error("Threads media processing timed out before publishing");
}
async function prepareThreads(
  job: DeliveryJob,
  images: DeliveryMedia[],
  token: string,
): Promise<PreparedPublication> {
  const children: string[] = [];
  if (images.length > 1) {
    for (const image of images) {
      if (!image.url) throw new Error("Threads requires a temporary media URL");
      const item = await threadsContainer(
        job.accountId,
        {
          ...threadsMedia(image),
          is_carousel_item: "true",
        },
        token,
      );
      await waitForThreadsContainer(item.id, token);
      children.push(item.id);
    }
  }
  const image = images[0];
  if (image && !image.url)
    throw new Error("Threads requires a temporary media URL");
  const container = await threadsContainer(
    job.accountId,
    {
      text: job.text,
      ...(job.replyTo ? { reply_to_id: job.replyTo.id } : {}),
      ...(children.length
        ? { media_type: "CAROUSEL", children: children.join(",") }
        : image
          ? threadsMedia(image)
          : { media_type: "TEXT" }),
    },
    token,
  );
  await waitForThreadsContainer(container.id, token);
  return {
    checkpoint: { containerId: container.id },
    publish: async () => {
      const result = await providerJson(
        `https://graph.threads.net/v1.0/${encodeURIComponent(job.accountId)}/threads_publish`,
        idResponse,
        {
          method: "POST",
          headers: {
            ...bearer(token),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ creation_id: container.id }),
        },
      );
      let url = "";
      try {
        const value = await providerJson(
          `https://graph.threads.net/v1.0/${encodeURIComponent(result.id)}?fields=permalink`,
          z.object({ permalink: z.string().url() }),
          { headers: bearer(token) },
        );
        url = value.permalink;
      } catch {
        /* The publish ID proves success even if the optional permalink lookup fails. */
      }
      return { id: result.id, url };
    },
  };
}
async function prepareBluesky(
  job: DeliveryJob,
  images: DeliveryMedia[],
): Promise<PreparedPublication> {
  const rkey = job.blueskyRecordKey;
  if (!isValidTid(rkey))
    throw new Error("This Bluesky delivery has no valid record key");
  const session = await (await blueskyClient()).restore(job.accountId);
  const agent = new Agent({
    did: session.did,
    fetchHandler: async (url, init) => {
      // XRPC normalizes HTTP 408 to 400, which would make an uncertain publish resumable.
      return checkProviderResponse(await session.fetchHandler(url, init));
    },
  });
  const video = images.find((item) => item.kind === "video");
  const videoBlob = video ? await uploadBlueskyVideo(agent, video) : undefined;
  const uploaded = [];
  for (const image of images) {
    if (image.kind === "video") continue;
    const { data } = await agent.uploadBlob(new Uint8Array(image.bytes), {
      encoding: "image/jpeg",
    });
    uploaded.push({
      alt: image.alt,
      image: data.blob,
      aspectRatio: { width: image.width, height: image.height },
    });
  }
  const link = !images.length ? firstPostLink(job.text) : null;
  const preview = link ? await getLinkPreview(link) : null;
  const thumb = preview?.image
    ? (
        await agent.uploadBlob(
          new Uint8Array(Buffer.from(preview.image.data, "base64")),
          { encoding: "image/jpeg" },
        )
      ).data.blob
    : undefined;
  const richText = new RichText({ text: job.text });
  await richText.detectFacets(agent);
  if (job.replyTo && (!job.replyTo.cid || !job.threadRoot?.cid))
    throw new Error("Bluesky thread references require confirmed record CIDs");
  const record = {
    $type: "app.bsky.feed.post",
    text: richText.text,
    facets: richText.facets,
    createdAt: new Date().toISOString(),
    ...(job.replyTo && job.threadRoot
      ? {
          reply: {
            root: { uri: job.threadRoot.id, cid: job.threadRoot.cid },
            parent: { uri: job.replyTo.id, cid: job.replyTo.cid },
          },
        }
      : {}),
    ...(video && videoBlob
      ? {
          embed: {
            $type: "app.bsky.embed.video",
            video: videoBlob,
            alt: video.alt,
            aspectRatio: { width: video.width, height: video.height },
          },
        }
      : uploaded.length
        ? { embed: { $type: "app.bsky.embed.images", images: uploaded } }
        : preview
          ? {
              embed: {
                $type: "app.bsky.embed.external",
                external: {
                  uri: preview.url,
                  title: preview.title,
                  description: preview.description,
                  ...(thumb ? { thumb } : {}),
                },
              },
            }
          : {}),
  };
  // Reuse the persisted TID across attempts so a lost response can be reconciled.
  return {
    checkpoint: { rkey },
    publish: async () => {
      try {
        const { data } = await agent.com.atproto.repo.putRecord({
          repo: job.accountId,
          collection: "app.bsky.feed.post",
          rkey,
          record,
          validate: true,
          swapRecord: null,
        });
        return {
          id: data.uri,
          cid: data.cid,
          url: `https://bsky.app/profile/${job.accountId}/post/${rkey}`,
        };
      } catch (error) {
        throw blueskyFailure(error);
      }
    },
  };
}

function blueskyFailure(error: unknown) {
  if (error instanceof ProviderFailure) return error;
  if (error instanceof XRPCError && error.cause instanceof ProviderFailure)
    return error.cause;
  if (error instanceof XRPCError && error.status >= 400)
    return new ProviderFailure(error.status, error.status >= 500);
  return new ProviderFailure(0, true);
}

function threadsMedia(media: DeliveryMedia): Record<string, string> {
  if (!media.url) throw new Error("Threads requires a temporary media URL");
  return media.kind === "video"
    ? { media_type: "VIDEO", video_url: media.url }
    : { media_type: "IMAGE", image_url: media.url, alt_text: media.alt };
}
const xProcessing = z.object({
  state: z.enum(["pending", "in_progress", "succeeded", "failed"]),
  check_after_secs: z.number().int().nonnegative().optional(),
});
const xMediaStatus = z.object({
  data: z.object({ processing_info: xProcessing.optional() }),
});
async function uploadXMotion(
  video: DeliveryVideo | DeliveryGif,
  token: string,
) {
  const headers = { ...bearer(token), "Content-Type": "application/json" };
  const { data } = await providerJson(
    "https://api.x.com/2/media/upload/initialize",
    z.object({ data: idResponse }),
    {
      ...jsonBody({
        total_bytes: video.bytes.length,
        media_type: video.kind === "gif" ? "image/gif" : "video/mp4",
        media_category: video.kind === "gif" ? "tweet_gif" : "tweet_video",
      }),
      headers,
    },
  );
  const chunkSize = 4 * 1024 * 1024;
  for (
    let start = 0, segment = 0;
    start < video.bytes.length;
    start += chunkSize, segment++
  ) {
    await providerRequest(
      `https://api.x.com/2/media/upload/${encodeURIComponent(data.id)}/append`,
      {
        ...jsonBody({
          media: video.bytes
            .subarray(start, start + chunkSize)
            .toString("base64"),
          segment_index: segment,
        }),
        headers,
      },
    );
  }
  let status = await providerJson(
    `https://api.x.com/2/media/upload/${encodeURIComponent(data.id)}/finalize`,
    xMediaStatus,
    { ...jsonBody({}), headers },
  );
  const deadline = Date.now() + 300_000;
  while (
    status.data.processing_info &&
    status.data.processing_info.state !== "succeeded"
  ) {
    if (status.data.processing_info.state === "failed")
      throw new Error("X could not process this media");
    if (Date.now() >= deadline)
      throw new Error("X media processing timed out before publishing");
    await delay(
      Math.max(
        1,
        Math.min(30, status.data.processing_info.check_after_secs ?? 2),
      ) * 1000,
    );
    status = await providerJson(
      `https://api.x.com/2/media/upload?${new URLSearchParams({ media_id: data.id, command: "STATUS" })}`,
      xMediaStatus,
      { headers: bearer(token) },
    );
  }
  return data.id;
}
async function uploadLinkedInVideo(
  video: DeliveryVideo,
  owner: string,
  token: string,
) {
  const headers = {
    ...linkedinHeaders(token),
    "Content-Type": "application/json",
  };
  const { value } = await providerJson(
    "https://api.linkedin.com/rest/videos?action=initializeUpload",
    z.object({
      value: z.object({
        video: z.string().startsWith("urn:li:video:"),
        uploadToken: z.string(),
        uploadInstructions: z
          .array(
            z.object({
              uploadUrl: z.string().url(),
              firstByte: z.number().int().nonnegative(),
              lastByte: z.number().int().nonnegative(),
            }),
          )
          .min(1),
      }),
    }),
    {
      ...jsonBody({
        initializeUploadRequest: {
          owner,
          fileSizeBytes: video.bytes.length,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      }),
      headers,
    },
  );
  const parts: string[] = [];
  let offset = 0;
  for (const part of value.uploadInstructions) {
    if (
      part.firstByte !== offset ||
      part.lastByte < offset ||
      part.lastByte >= video.bytes.length
    )
      throw new Error("LinkedIn returned an invalid video upload range");
    const response = await providerRequest(
      trustedLinkedInUpload(part.uploadUrl),
      {
        method: "PUT",
        headers: {
          ...bearer(token),
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(
          video.bytes.subarray(part.firstByte, part.lastByte + 1),
        ),
      },
    );
    const etag = response.headers.get("etag");
    if (!etag) throw new Error("LinkedIn did not acknowledge the video part");
    parts.push(etag.replace(/^"|"$/g, ""));
    offset = part.lastByte + 1;
  }
  if (offset !== video.bytes.length)
    throw new Error("LinkedIn did not request the complete video");
  await providerRequest(
    "https://api.linkedin.com/rest/videos?action=finalizeUpload",
    {
      ...jsonBody({
        finalizeUploadRequest: {
          video: value.video,
          uploadToken: value.uploadToken,
          uploadedPartIds: parts,
        },
      }),
      headers,
    },
  );
  for (let attempt = 0; attempt < 150; attempt++) {
    const result = await providerJson(
      `https://api.linkedin.com/rest/videos/${encodeURIComponent(value.video)}`,
      z.object({
        status: z.enum([
          "WAITING_UPLOAD",
          "PROCESSING",
          "PROCESSING_FAILED",
          "AVAILABLE",
        ]),
      }),
      { headers: linkedinHeaders(token) },
    );
    if (result.status === "AVAILABLE") return value.video;
    if (result.status === "PROCESSING_FAILED")
      throw new Error("LinkedIn could not process this video");
    await delay(2000);
  }
  throw new Error("LinkedIn video processing timed out before publishing");
}
const videoBlob = z.object({
  $type: z.literal("blob"),
  ref: z.object({ $link: z.string().min(1) }),
  mimeType: z.literal("video/mp4"),
  size: z.number().int().positive(),
});
const blueskyJob = z.object({
  jobStatus: z.object({
    jobId: z.string().min(1),
    state: z.string(),
    blob: videoBlob.optional(),
    error: z.string().optional(),
  }),
});
async function uploadBlueskyVideo(agent: Agent, video: DeliveryVideo) {
  const { data: server } = await agent.com.atproto.server.describeServer();
  if (!server.did)
    throw new Error(
      "This Bluesky server does not provide video upload authorization",
    );
  const { data: auth } = await agent.com.atproto.server.getServiceAuth({
    aud: server.did,
    lxm: "com.atproto.repo.uploadBlob",
    exp: Math.floor(Date.now() / 1000) + 1800,
  });
  const headers = bearer(auth.token);
  const { jobId, partSizeBytes, partCount } = await providerJson(
    "https://video.bsky.app/xrpc/app.bsky.video.startUpload",
    z.object({
      jobId: z.string().min(1),
      partSizeBytes: z
        .number()
        .int()
        .min(1)
        .max(16 * 1024 * 1024),
      partCount: z.number().int().positive(),
    }),
    {
      ...jsonBody({
        sizeBytes: video.bytes.length,
        mimeType: "video/mp4",
        name: `${video.id}.mp4`,
        durationMs: Math.round(video.durationSeconds * 1000),
        width: video.width,
        height: video.height,
      }),
      headers: { ...headers, "Content-Type": "application/json" },
    },
  );
  if (partCount !== Math.ceil(video.bytes.length / partSizeBytes))
    throw new Error("Bluesky returned an invalid video upload plan");
  for (let part = 0; part < partCount; part++) {
    await providerRequest(
      `https://video.bsky.app/xrpc/app.bsky.video.uploadPart?${new URLSearchParams({ jobId, partNumber: String(part + 1) })}`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/octet-stream" },
        body: new Uint8Array(
          video.bytes.subarray(
            part * partSizeBytes,
            (part + 1) * partSizeBytes,
          ),
        ),
      },
    );
  }
  let result = await providerJson(
    "https://video.bsky.app/xrpc/app.bsky.video.finishUpload",
    blueskyJob,
    {
      ...jsonBody({ jobId }),
      headers: { ...headers, "Content-Type": "application/json" },
    },
  );
  for (let attempt = 0; attempt < 150; attempt++) {
    if (result.jobStatus.blob) return result.jobStatus.blob;
    if (result.jobStatus.state === "JOB_STATE_FAILED" || result.jobStatus.error)
      throw new Error("Bluesky could not process this video");
    await delay(2000);
    result = await providerJson(
      `https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?${new URLSearchParams({ jobId: result.jobStatus.jobId })}`,
      blueskyJob,
    );
  }
  throw new Error("Bluesky video processing timed out before publishing");
}
