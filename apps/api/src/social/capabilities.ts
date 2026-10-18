import type {
  Provider,
  ProviderCapabilities,
} from "../../../../packages/contracts/src/index.js";
import { imageLimits } from "../../../../packages/contracts/src/images.js";

import { videoDurationLimits } from "../../../../packages/contracts/src/media.js";

// Conservative output limits; provider validation also runs immediately before publishing.
export const capabilities: Record<Provider, ProviderCapabilities> = {
  x: {
    id: "x",
    name: "X",
    maxCharacters: 280,
    maxImages: imageLimits.x,
    maxVideos: 1,
    maxVideoDurationSeconds: videoDurationLimits.x,
    maxImageBytes: 5_000_000,
    maxImageDimension: 4096,
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    maxCharacters: 3000,
    maxImages: imageLimits.linkedin,
    maxVideos: 1,
    maxVideoDurationSeconds: videoDurationLimits.linkedin,
    maxImageBytes: 5_000_000,
    maxImageDimension: 4096,
  },
  "linkedin-pages": {
    id: "linkedin-pages",
    name: "LinkedIn Pages",
    maxCharacters: 3000,
    maxImages: imageLimits.linkedin,
    maxVideos: 1,
    maxVideoDurationSeconds: videoDurationLimits.linkedin,
    maxImageBytes: 5_000_000,
    maxImageDimension: 4096,
  },
  bluesky: {
    id: "bluesky",
    name: "Bluesky",
    maxCharacters: 300,
    maxImages: imageLimits.bluesky,
    maxVideos: 1,
    maxVideoDurationSeconds: videoDurationLimits.bluesky,
    maxImageBytes: 2_000_000,
    maxImageDimension: 4000,
  },
  threads: {
    id: "threads",
    name: "Threads",
    maxCharacters: 500,
    maxImages: imageLimits.threads,
    maxVideos: 20,
    maxVideoDurationSeconds: videoDurationLimits.threads,
    maxImageBytes: 8_000_000,
    maxImageDimension: 1440,
  },
};

export function enabledProviders(
  env: NodeJS.ProcessEnv,
): ProviderCapabilities[] {
  const required: Record<Provider, string[]> = {
    x: ["POSTED_X_CLIENT_ID", "POSTED_X_CLIENT_SECRET"],
    linkedin: ["POSTED_LINKEDIN_CLIENT_ID", "POSTED_LINKEDIN_CLIENT_SECRET"],
    "linkedin-pages": [
      "POSTED_LINKEDIN_PAGES_CLIENT_ID",
      "POSTED_LINKEDIN_PAGES_CLIENT_SECRET",
    ],
    threads: ["POSTED_THREADS_CLIENT_ID", "POSTED_THREADS_CLIENT_SECRET"],
    bluesky: ["POSTED_BLUESKY_CLIENT_ID", "POSTED_BLUESKY_PRIVATE_KEY_JWK"],
  };
  return Object.values(capabilities).filter((provider) =>
    required[provider.id].every((key) => Boolean(env[key]?.trim())),
  );
}
