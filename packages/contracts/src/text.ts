import twitterText from "twitter-text";
import type { Provider } from "./index.js";

export const characterLimits: Record<Provider, number> = {
  x: 280,
  linkedin: 3000,
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
