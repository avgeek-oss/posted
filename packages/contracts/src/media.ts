import type { Provider } from "./index.js";
import { imageLimits } from "./images.js";

export const videoUploadBytes = 100 * 1024 * 1024;
export const videoDurationLimits: Record<Provider, number> = {
  x: 140,
  linkedin: 1800,
  bluesky: 180,
  threads: 300,
};
export const isVideo = (media: { contentType: string }) =>
  media.contentType.startsWith("video/");

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
  media: readonly { contentType: string; durationSeconds: number | null }[],
): string | undefined {
  if (
    provider !== "threads" &&
    media.some(isVideo) &&
    media.some((item) => !isVideo(item))
  )
    return "Choose images or a video for this post.";
  const selected = mediaForProvider(provider, media);
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
