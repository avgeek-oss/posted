import twitterText from "twitter-text";
import type { Provider } from "./index.js";

export const characterLimits: Record<Provider, number> = {
  x: 280,
  linkedin: 3000,
  "linkedin-pages": 3000,
  "facebook-pages": 3000,
  instagram: 2200,
  bluesky: 300,
  threads: 500,
};
export function providerTextLength(provider: Provider, text: string) {
  if (provider === "x") return twitterText.parseTweet(text).weightedLength;
  if (provider === "bluesky")
    return [
      ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text),
    ].length;
  return [...text].length;
}

export function textForProviderPreview(provider: Provider, text: string) {
  const limit = characterLimits[provider];
  if (provider === "x") {
    const normalized = text.normalize();
    const parsed = twitterText.parseTweet(normalized);
    return parsed.weightedLength <= limit
      ? text
      : normalized.slice(0, parsed.validRangeEnd + 1);
  }
  if (provider === "bluesky")
    return [
      ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text),
    ]
      .slice(0, limit)
      .map(({ segment }) => segment)
      .join("");
  return [...text].slice(0, limit).join("");
}

export function providerCaptionError(provider: Provider, text: string) {
  if (provider !== "instagram") return;
  if ((text.match(/(?:^|[^\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu) ?? []).length > 30)
    return "Instagram supports up to 30 hashtags per caption.";
  if ((text.match(/(?:^|[^\p{L}\p{N}_.])@[A-Za-z0-9_.]+/gu) ?? []).length > 20)
    return "Instagram supports up to 20 mentions per caption.";
}
