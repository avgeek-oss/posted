import { createHash } from "node:crypto";
import { z } from "zod";
import { providerTextLength } from "../../../../packages/contracts/src/text.js";
import type { Provider } from "../../../../packages/contracts/src/index.js";
import { capabilities } from "../social/capabilities.js";

export const postInput = z
  .object({
    text: z.string().max(3000),
    textOverrides: z.record(z.uuid(), z.string().max(3000)).default({}),
    connectionIds: z
      .array(z.uuid())
      .min(1)
      .max(50)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Select each account once",
      ),
    mediaIds: z
      .array(z.uuid())
      .max(20)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Select each media item once",
      ),
    scheduledAt: z.iso.datetime(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
    draftSource: z
      .object({ id: z.uuid(), version: z.number().int().positive() })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.connectionIds.every(
        (id) =>
          (value.textOverrides[id] ?? value.text).trim().length > 0 ||
          value.mediaIds.length > 0,
      ),
    "Add text or media for each selected account",
  )
  .refine(
    (value) =>
      Object.keys(value.textOverrides).every((id) =>
        value.connectionIds.includes(id),
      ),
    "Only selected accounts can have custom text",
  );

export function contentHash(input: z.infer<typeof postInput>): string {
  const { textOverrides, ...request } = input;
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...request,
        ...(Object.keys(textOverrides).length
          ? {
              textOverrides: Object.fromEntries(
                Object.entries(textOverrides).sort(([left], [right]) =>
                  left.localeCompare(right),
                ),
              ),
            }
          : {}),
        connectionIds: [...input.connectionIds].sort(),
      }),
    )
    .digest("hex");
}
export function validateProviderContent(
  provider: Provider,
  text: string,
  imageCount: number,
) {
  const limit = capabilities[provider];
  const count = providerTextLength(provider, text);
  if (count > limit.maxCharacters)
    throw new Error(
      `${limit.name} supports up to ${limit.maxCharacters} characters`,
    );
  if (imageCount > limit.maxImages)
    throw new Error(
      `${limit.name} supports up to ${limit.maxImages} images per post`,
    );
}
