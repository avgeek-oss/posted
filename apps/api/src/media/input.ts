import { z } from "zod";
import { videoUploadBytes } from "../../../../packages/contracts/src/media.js";
export const mediaTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
] as const;
export const uploadInput = z
  .object({
    fileName: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => !/\p{Cc}/u.test(value)),
    contentType: z.enum(mediaTypes),
    sizeBytes: z.number().int().min(1).max(videoUploadBytes),
    alt: z.string().max(2000).default(""),
  })
  .strict();
