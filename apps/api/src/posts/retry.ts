import { z } from "zod";
import type { DeliveryState } from "../../../../packages/contracts/src/index.js";

export const deliveryAttemptLimit = 5;
export const retryBaseMilliseconds = 30_000;
export const retryMaximumMilliseconds = 30 * 60_000;

export function deliveryRetryDelay(attempt: number, retryAfterMs = 0) {
  const backoff = Math.min(
    retryMaximumMilliseconds,
    retryBaseMilliseconds * 2 ** Math.max(0, attempt - 1),
  );
  return Math.max(
    backoff + Math.floor(Math.random() * backoff * 0.25),
    retryAfterMs,
  );
}

export const resumeInput = z
  .object({
    connectionId: z.uuid(),
    version: z.number().int().positive(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  })
  .strict();

export type ResumeDelivery = {
  postIndex: number;
  state: DeliveryState;
  providerPostId: string | null;
  providerPostCid: string | null;
  publishedAt: string | Date | null;
};

export function interruptedSequence(
  deliveries: readonly ResumeDelivery[],
  provider: string,
) {
  const ordered = [...deliveries].sort((a, b) => a.postIndex - b.postIndex);
  let interrupted = false;
  for (const [index, delivery] of ordered.entries()) {
    if (delivery.postIndex !== index) return false;
    if (delivery.state === "published") {
      if (
        interrupted ||
        !delivery.providerPostId ||
        (provider === "bluesky" && !delivery.providerPostCid)
      )
        return false;
    } else {
      if (
        delivery.state !== "failed" ||
        delivery.providerPostId ||
        delivery.providerPostCid ||
        delivery.publishedAt
      )
        return false;
      interrupted = true;
    }
  }
  return interrupted;
}
