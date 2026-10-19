import type { Provider } from "./index.js";
import { imageLimits } from "./images.js";

export const videoUploadBytes = 100 * 1024 * 1024;
export const videoDurationLimits: Record<Provider, number> = {
  x: 140,
  linkedin: 1800,
  "linkedin-pages": 1800,
  "facebook-pages": 1800,
  instagram: 900,
  bluesky: 180,
  threads: 300,
};
export const isVideo = (media: { contentType: string }) =>
  media.contentType.startsWith("video/");
export const isGif = (media: { contentType: string }) =>
  media.contentType === "image/gif";

export function mediaForProvider<T extends { contentType: string }>(
  provider: Provider,
  media: readonly T[],
) {
  if (provider === "threads") return media.slice(0, 20);
  const videos = media.filter(isVideo);
  return videos.length
    ? videos.slice(0, 1)
    : media.slice(0, imageLimits[provider]);
}
export function mediaError(
  provider: Provider,
  media: readonly {
    contentType: string;
    durationSeconds: number | null;
    alt?: string;
  }[],
): string | undefined {
  const selected = mediaForProvider(provider, media);
  if (
    provider === "instagram" &&
    selected.some(
      (item) =>
        !isVideo(item) && !isGif(item) && [...(item.alt ?? "")].length > 1000,
    )
  )
    return "Instagram photo descriptions must be 1,000 characters or fewer.";
  if (provider === "instagram" && !media.length)
    return "Add a photo or video for Instagram. Captions need media.";
  if (media.some(isGif) && media.length > 1)
    return "Use one GIF without other images or videos in this post.";
  if (
    provider !== "threads" &&
    media.some(isVideo) &&
    media.some((item) => !isVideo(item))
  )
    return "Choose images or a video for this post.";
  if (
    selected.some(
      (item) =>
        isVideo(item) &&
        (item.durationSeconds === null ||
          item.durationSeconds < 3 ||
          item.durationSeconds > videoDurationLimits[provider]),
    )
  )
    return `Videos must be between 3 and ${videoDurationLimits[provider]} seconds for this account.`;
}
